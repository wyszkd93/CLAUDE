import type { Message } from "./types.ts";

export type CompleteRequest = { system: string; messages: Message[]; model?: string; signal?: AbortSignal };

/** 프로바이더 어댑터는 이 하나만 구현한다(설계서 5절). 오류는 throw 로 알린다. */
export interface ProviderAdapter {
  readonly id: string;
  complete(req: CompleteRequest): Promise<string>;
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
