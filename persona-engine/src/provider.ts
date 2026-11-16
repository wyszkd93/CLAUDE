import type { Message } from "./types.ts";

export type CompleteRequest = { system: string; messages: Message[]; model?: string; signal?: AbortSignal };

/** 프로바이더 어댑터는 이 하나만 구현한다(설계서 5절). 오류는 throw 로 알린다. */
export interface ProviderAdapter {
  readonly id: string;
  complete(req: CompleteRequest): Promise<string>;
}

export type ProviderErrorKind =
  | "auth" | "billing" | "rate_limit" | "refusal" | "truncated" | "bad_request"
  | "not_found" | "timeout" | "network" | "server" | "aborted" | "unknown";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["rate_limit", "timeout", "network", "server"]);

/**
 * 프로바이더 오류를 벤더와 무관하게 분류한다. retryable=false 인 오류(인증·결제·거부·잘못된 요청 등)는
 * 같은 요청을 다시 보내도 같은 결과이므로 호출자가 재시도하지 않는다.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  /** refusal 일 때 정책 분류(예: cyber). 알 수 없으면 undefined */
  readonly category?: string;
  constructor(kind: ProviderErrorKind, message: string, o: { status?: number; category?: string; cause?: unknown } = {}) {
    super(message, o.cause === undefined ? undefined : { cause: o.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = RETRYABLE.has(kind);
    this.status = o.status;
    this.category = o.category;
  }
}

export type FakeReply = string | Error | ((req: CompleteRequest, callIndex: number) => string | Error);
export type FakeRule = {
  /** 마지막 user 메시지에 매치(정규식) 또는 요청 전체로 판정(함수). 생략하면 항상 매치. */
  when?: RegExp | ((req: CompleteRequest) => boolean);
  reply: FakeReply;
};
export type FakeProvider = ProviderAdapter & { readonly calls: CompleteRequest[] };

/**
 * 테스트·하네스 개발용 가짜 프로바이더. 네트워크도 키도 쓰지 않고 완전히 결정적이다.
 * 규칙을 위에서부터 보고 처음 매치된 것의 reply 를 쓴다. 규칙이 없으면 fallback, 그것도 없으면 오류.
 * reply 가 Error 면 throw 한다(인증·타임아웃 같은 실패를 흉내 낼 때).
 */
export function createFakeProvider(id: string, rules: FakeRule[], fallback?: FakeReply): FakeProvider {
  const calls: CompleteRequest[] = [];
  return {
    id,
    calls,
    async complete(req) {
      if (req.signal?.aborted) throw new Error("aborted");
      const n = calls.length;
      calls.push(req);
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const rule = rules.find((r) => !r.when || (r.when instanceof RegExp ? r.when.test(lastUser) : r.when(req)));
      const reply = rule?.reply ?? fallback;
      if (reply === undefined) throw new Error(`fake provider ${id}: 매치되는 규칙이 없음 (입력: ${lastUser.slice(0, 40)})`);
      const out = typeof reply === "function" ? reply(req, n) : reply;
      if (out instanceof Error) throw out;
      return out;
    },
  };
}
