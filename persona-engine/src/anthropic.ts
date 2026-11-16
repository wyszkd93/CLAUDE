// Anthropic 어댑터. 공식 SDK(@anthropic-ai/sdk)로 Messages API 를 호출한다.
// 코어(index.ts)는 이 파일을 가져오지 않는다 — SDK 없이도 코어를 쓸 수 있게 하려는 것.
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type CompleteRequest, type ProviderAdapter } from "./provider.ts";

/** 스킬 문서(2026-11-03 캐시)의 기본 모델. 바꾸려면 옵션이나 요청의 model 로 덮어쓴다. 모델 ID 는 날짜 접미사 없이 이 형태 그대로 쓴다. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_MAX_TOKENS = 16000; // 비스트리밍 기본값(SDK HTTP 타임아웃 안쪽)
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

type ApiResponse = {
  content: { type: string; text?: string }[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
};
type Create = (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<ApiResponse>;
/** 어댑터가 쓰는 SDK 클라이언트의 최소 모양. 진짜 Anthropic 인스턴스도, 테스트용 가짜도 만족한다. */
export type AnthropicLike = { messages: { create: Create }; beta: { messages: { create: Create } } };

export type AnthropicProviderOpts = {
  client?: AnthropicLike;
  id?: string;
  model?: string;
  maxTokens?: number;
  /** 기본 medium(Claude Opus 5.5 의 기본값이지만 문서 지침대로 명시한다) */
  effort?: Effort;
  /**
   * 기본 true: 안전 분류기가 거부하면 서버가 같은 요청을 대체 모델로 다시 돌린다(beta, fallbacks:"default").
   * 이 베타가 조직에 열려 있지 않으면 400 이 나므로, 그때는 false 로 끈다.
   */
  refusalFallback?: boolean;
};

/** SDK/네트워크 오류를 ProviderError 로 분류한다. 이 어댑터 밖의 프로그래밍 오류와 구분되도록 분류 못 한 것도 unknown 으로 감싼다. */
export function mapAnthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", msg, { cause: e });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", msg, { cause: e });
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("network", msg, { cause: e });
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    const o = { status, cause: e };
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError("auth", msg, o);
    if (status === 402) return new ProviderError("billing", msg, o);
    if (e instanceof Anthropic.RateLimitError) return new ProviderError("rate_limit", msg, o);
    if (e instanceof Anthropic.BadRequestError) return new ProviderError("bad_request", msg, o);
    if (e instanceof Anthropic.NotFoundError) return new ProviderError("not_found", msg, o);
    if (typeof status === "number" && status >= 500) return new ProviderError("server", msg, o); // 529 Overloaded 포함
    return new ProviderError("unknown", msg, o);
  }
  // SDK 가 요청 전에 던지는 일반 Error(예: 인증 정보를 못 찾음)도 여기로 온다. 재시도해 봐야 같으므로 non-retryable.
  return new ProviderError("unknown", msg, { cause: e });
}

export function createAnthropicProvider(opts: AnthropicProviderOpts = {}): ProviderAdapter {
  const client: AnthropicLike = opts.client ?? (new Anthropic() as unknown as AnthropicLike); // 인증은 환경(ANTHROPIC_API_KEY 등)에서 해석된다. 키를 코드에 넣지 않는다
  const useFallback = opts.refusalFallback ?? true;
  const effort = opts.effort ?? "medium";
  return {
    id: opts.id ?? "anthropic",
    async complete(req: CompleteRequest): Promise<string> {
      // temperature/top_p/top_k 와 thinking 은 보내지 않는다(이 모델 계열에서는 400 이거나 기본이 이미 적응형 사고).
      const params: Record<string, unknown> = {
        model: req.model ?? opts.model ?? DEFAULT_ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        output_config: { effort },
      };
      if (req.system) params.system = req.system;
      if (useFallback) { params.betas = [FALLBACK_BETA]; params.fallbacks = "default"; }

      let res: ApiResponse;
      try {
        const api = useFallback ? client.beta.messages : client.messages;
        res = await api.create(params, req.signal ? { signal: req.signal } : undefined);
      } catch (e) {
        throw mapAnthropicError(e);
      }

      if (res.stop_reason === "refusal") {
        const d = res.stop_details;
        throw new ProviderError("refusal", `모델이 요청을 거부함${d?.category ? ` (${d.category})` : ""}${d?.explanation ? `: ${d.explanation}` : ""}`, { category: d?.category ?? undefined });
      }
      if (res.stop_reason === "max_tokens") throw new ProviderError("truncated", "max_tokens 에서 응답이 잘림");
      return res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    },
  };
}
