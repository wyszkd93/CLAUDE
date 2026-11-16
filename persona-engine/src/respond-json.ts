import { canned } from "./canned.ts";
import { compose } from "./compose.ts";
import { flair } from "./flair.ts";
import { guardOutput } from "./guard.ts";
import { ProviderError, type ProviderAdapter } from "./provider.ts";
import type { MemorySnippet, Message, MessageKind, Mood, Persona } from "./types.ts";

export const DEFAULT_MAX_RETRIES = 1; // 설계서 3.3 의 가정값

export type JsonFallback = {
  /** 말투 문구를 넣을 필드(styledFields 중 하나) */
  field: string;
  /** persona.canned 의 키. 있으면 우선 쓰고, 없거나 못 고르면 text */
  cannedKey?: string;
  vars?: Record<string, string | number>;
  /** 중립 문구(페르소나 말투를 입히지 않는다) */
  text: string;
};

export type RespondJsonInput = {
  persona: Persona;
  provider: ProviderAdapter;
  input: string;
  kind?: MessageKind;
  seed: string;
  mood?: Mood;
  task?: string;
  context?: string;
  memory?: MemorySnippet[];
  /** untouchedFields 중 호출자가 값을 아는 것. 응답이 이 값과 한 글자라도 다르면 거부한다 */
  expected: Record<string, unknown>;
  /** 응답에 반드시 있어야 하는 필드 */
  required?: string[];
  fallback?: JsonFallback;
  maxRetries?: number;
  model?: string;
  signal?: AbortSignal;
};

export type RespondJsonResult =
  | { status: "ok"; value: Record<string, unknown>; attempts: number }
  | { status: "fallback"; value: Record<string, unknown>; attempts: number; reasons: string[] }
  | { status: "failed"; value: null; attempts: number; reasons: string[] };

/** 코드펜스·앞뒤 설명이 붙은 응답에서 첫 JSON 객체를 꺼낸다. 못 찾으면 null. */
export function extractJson(text: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try { const v: unknown = JSON.parse(s); return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
  };
  const whole = tryParse(text.trim());
  if (whole) return whole;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return tryParse(text.slice(start, i + 1));
  }
  return null;
}

const retryNote = (locale: string, reasons: string[]) =>
  locale.toLowerCase().startsWith("ko")
    ? `이전 응답이 규칙을 어겼다: ${reasons.join("; ")}. 같은 요청에 JSON 객체 하나로만 다시 답한다.`
    : `Your previous reply broke the rules: ${reasons.join("; ")}. Answer the same request again with a single JSON object only.`;

/**
 * JSON 출력 경로: compose → provider → 파싱 → guardOutput → (실패 시 재시도) → flair(styledFields 만) → (그래도 실패 시 폴백).
 * 안전 필드(untouched)는 고쳐 쓰지 않고, 어기면 그 응답을 통째로 버린다. 폴백 값도 모델 출력이 아니라 expected 로 채운다.
 */
export async function respondJson(i: RespondJsonInput): Promise<RespondJsonResult> {
  const kind = i.kind ?? "chat";
  const maxRetries = i.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new RangeError("maxRetries 는 0 이상의 정수");
  const { system, examples } = compose({ persona: i.persona, kind, task: i.task, context: i.context, memory: i.memory, output: { format: "json" } });
  const messages: Message[] = [...examples, { role: "user", content: i.input }];

  let reasons: string[] = [];
  let attempts = 0;
  for (let n = 0; n <= maxRetries; n++) {
    if (i.signal?.aborted) throw new Error("aborted");
    attempts++;
    let raw: string;
    try {
      raw = await i.provider.complete({ system, messages: [...messages], model: i.model, signal: i.signal });
    } catch (e) {
      if (i.signal?.aborted) throw e;
      reasons = [`프로바이더 오류: ${(e as Error).message}`];
      if (e instanceof ProviderError && !e.retryable) break; // 인증·결제·거부 등은 다시 보내도 같다
      continue; // 같은 messages 로 다시 시도
    }
    const obj = extractJson(raw);
    reasons = [];
    if (!obj) reasons.push("JSON 객체가 아님");
    else {
      reasons.push(...guardOutput(obj, i.persona, i.expected).reasons);
      for (const f of i.required ?? []) if (!(f in obj)) reasons.push(`필수 필드 누락: ${f}`);
    }
    if (obj && reasons.length === 0) {
      const value = { ...obj };
      for (const f of i.persona.safety.styledFields ?? []) {
        if (typeof value[f] === "string") value[f] = flair(value[f] as string, i.persona, { seed: `${i.seed}:${f}`, kind, mood: i.mood });
      }
      return { status: "ok", value, attempts };
    }
    messages.push({ role: "assistant", content: raw }, { role: "user", content: retryNote(i.persona.locale, reasons) });
  }

  if (!i.fallback) return { status: "failed", value: null, attempts, reasons };
  const text = (i.fallback.cannedKey && canned(i.persona, i.fallback.cannedKey, i.fallback.vars ?? {}, i.seed)) || i.fallback.text;
  return { status: "fallback", value: { ...i.expected, [i.fallback.field]: text }, attempts, reasons };
}
