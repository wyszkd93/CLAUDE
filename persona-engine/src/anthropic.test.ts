import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicProvider, mapAnthropicError, DEFAULT_ANTHROPIC_MODEL, FALLBACK_BETA } from "./anthropic.ts";
import type { AnthropicLike } from "./anthropic.ts";
import { ProviderError, respondJson, runEval } from "./index.ts";
import type { Persona } from "./index.ts";

const bori: Persona = JSON.parse(readFileSync(new URL("../examples/bori.persona.json", import.meta.url), "utf8"));
type Call = { api: "messages" | "beta"; params: Record<string, unknown>; opts?: { signal?: AbortSignal } };
const ok = (text: string, extra: object = {}) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", ...extra });

/** 네트워크 없는 가짜 SDK 클라이언트. 응답(또는 던질 오류)을 순서대로 돌려준다. */
function fakeClient(...script: (object | Error)[]) {
  const calls: Call[] = [];
  const make = (api: Call["api"]) => ({
    async create(params: Record<string, unknown>, opts?: { signal?: AbortSignal }) {
      calls.push({ api, params, opts });
      const next = script[Math.min(calls.length - 1, script.length - 1)];
      if (next instanceof Error) throw next;
      return next as never;
    },
  });
  const client: AnthropicLike = { messages: make("messages"), beta: { messages: make("beta") } };
  return { client, calls };
}
const apiErr = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "m" } }, `HTTP ${status}`, new Headers());
const req = (extra = {}) => ({ system: "SYS", messages: [{ role: "user" as const, content: "안녕" }], ...extra });

test("요청 모양: 기본 모델·effort 명시, 금지 파라미터 없음, fallback 은 beta 엔드포인트로", async () => {
  const { client, calls } = fakeClient(ok("네."));
  const text = await createAnthropicProvider({ client }).complete(req());
  assert.equal(text, "네.");
  const c = calls[0];
  assert.equal(c.api, "beta");
  assert.equal(c.params.model, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(c.params.model, "claude-opus-5-5");
  assert.deepEqual(c.params.output_config, { effort: "medium" });
  assert.deepEqual(c.params.betas, [FALLBACK_BETA]);
  assert.equal(c.params.fallbacks, "default");
  assert.equal(c.params.system, "SYS");
  assert.deepEqual(c.params.messages, [{ role: "user", content: "안녕" }]);
  for (const banned of ["temperature", "top_p", "top_k", "thinking"]) assert.ok(!(banned in c.params), `${banned} 를 보내면 안 됨`);
  assert.ok(Number.isInteger(c.params.max_tokens) && (c.params.max_tokens as number) >= 1);
});

test("refusalFallback=false 면 일반 엔드포인트, beta·fallbacks 없음", async () => {
  const { client, calls } = fakeClient(ok("네."));
  await createAnthropicProvider({ client, refusalFallback: false }).complete(req());
  assert.equal(calls[0].api, "messages");
  assert.ok(!("betas" in calls[0].params) && !("fallbacks" in calls[0].params));
});

test("모델 우선순위: 요청 > 옵션 > 기본, effort·maxTokens 옵션 반영, 빈 system 은 생략, signal 전달", async () => {
  const { client, calls } = fakeClient(ok("a"), ok("b"));
  const p = createAnthropicProvider({ client, model: "opt-model", effort: "low", maxTokens: 123 });
  const ac = new AbortController();
  await p.complete(req({ model: "req-model", signal: ac.signal }));
  await p.complete(req({ system: "" }));
  assert.equal(calls[0].params.model, "req-model");
  assert.equal(calls[1].params.model, "opt-model");
  assert.deepEqual(calls[0].params.output_config, { effort: "low" });
  assert.equal(calls[0].params.max_tokens, 123);
  assert.ok(!("system" in calls[1].params));
  assert.equal(calls[0].opts?.signal, ac.signal);
  assert.equal(calls[1].opts, undefined);
});

test("응답: text 블록만 이어 붙이고 thinking·fallback 블록은 무시", async () => {
  const { client } = fakeClient({ content: [{ type: "thinking", thinking: "" }, { type: "fallback" }, { type: "text", text: "가" }, { type: "text", text: "나" }], stop_reason: "end_turn" });
  assert.equal(await createAnthropicProvider({ client }).complete(req()), "가나");
  const { client: c2 } = fakeClient({ content: [], stop_reason: "end_turn" });
  assert.equal(await createAnthropicProvider({ client: c2 }).complete(req()), "");
});

test("refusal 은 category 와 함께 non-retryable 오류, max_tokens 는 truncated", async () => {
  const { client } = fakeClient({ content: [], stop_reason: "refusal", stop_details: { category: "cyber", explanation: "x" } });
  await assert.rejects(createAnthropicProvider({ client }).complete(req()), (e: unknown) => e instanceof ProviderError && e.kind === "refusal" && e.category === "cyber" && !e.retryable);
  const { client: c2 } = fakeClient({ content: [{ type: "text", text: "잘린" }], stop_reason: "max_tokens" });
  await assert.rejects(createAnthropicProvider({ client: c2 }).complete(req()), (e: unknown) => e instanceof ProviderError && e.kind === "truncated" && !e.retryable);
});

test("오류 분류: 실제 SDK 오류 객체 → kind/retryable", () => {
  const cases: [Error, string, boolean][] = [
    [apiErr(400), "bad_request", false], [apiErr(401), "auth", false], [apiErr(402), "billing", false], [apiErr(403), "auth", false],
    [apiErr(404), "not_found", false], [apiErr(429), "rate_limit", true], [apiErr(500), "server", true], [apiErr(529), "server", true],
    [apiErr(418), "unknown", false],
    [new Anthropic.APIConnectionTimeoutError(), "timeout", true], [new Anthropic.APIConnectionError({ message: "down" }), "network", true],
    [new Anthropic.APIUserAbortError(), "aborted", false], [new Error("Could not resolve authentication method"), "unknown", false],
  ];
  for (const [err, kind, retryable] of cases) {
    const m = mapAnthropicError(err);
    assert.equal(m.kind, kind, `${err.constructor.name}`);
    assert.equal(m.retryable, retryable, `${err.constructor.name}`);
    assert.equal(m.cause, err);
  }
  const own = new ProviderError("refusal", "x");
  assert.equal(mapAnthropicError(own), own);
});

test("complete: SDK 오류가 ProviderError 로 바뀌어 던져진다", async () => {
  const { client } = fakeClient(apiErr(401));
  await assert.rejects(createAnthropicProvider({ client }).complete(req()), (e: unknown) => e instanceof ProviderError && e.kind === "auth" && e.status === 401);
});

test("respondJson: 인증 오류는 재시도하지 않고 즉시 중단(호출 1번), 서버 오류는 재시도", async () => {
  const exp = { id: "t1", command: "x", status: "p" };
  const auth = fakeClient(apiErr(401));
  const r1 = await respondJson({ persona: bori, provider: createAnthropicProvider({ client: auth.client }), input: "?", seed: "s", expected: exp });
  assert.equal(r1.status, "failed"); assert.equal(r1.attempts, 1); assert.equal(auth.calls.length, 1);
  const flaky = fakeClient(apiErr(529), ok(JSON.stringify({ ...exp, reply: "네요." })));
  const r2 = await respondJson({ persona: bori, provider: createAnthropicProvider({ client: flaky.client }), input: "?", seed: "s", expected: exp });
  assert.equal(r2.status, "ok"); assert.equal(flaky.calls.length, 2);
});

test("runEval: 어댑터를 그대로 하네스에 꽂을 수 있다(거부 응답은 실패로 집계)", async () => {
  const { client } = fakeClient({ content: [], stop_reason: "refusal", stop_details: { category: null } });
  const r = await runEval(bori, createAnthropicProvider({ client, id: "anthropic-fake" }), { repeats: 2 });
  assert.equal(r.provider, "anthropic-fake");
  assert.equal(r.verdict, "fail");
  assert.ok(r.probes[0].failures[0].startsWith("프로바이더 오류: 모델이 요청을 거부함"));
});
