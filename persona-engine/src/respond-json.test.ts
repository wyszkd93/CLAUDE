import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeProvider, respondJson, extractJson, seedHash } from "./index.ts";
import type { Persona } from "./index.ts";

const bori: Persona = JSON.parse(readFileSync(new URL("../examples/bori.persona.json", import.meta.url), "utf8"));
const exp = { id: "t1", command: "rm x", status: "pending" };
const j = (o: unknown) => JSON.stringify(o);
const okObj = { id: "t1", command: "rm x", status: "pending", reply: "확인이 필요해요." };
const seedHit = (() => { for (let i = 0; i < 1000; i++) if (seedHash(`j${i}:reply`) % 4 === 0) return `j${i}`; throw new Error(); })();
const seedMiss = (() => { for (let i = 0; i < 1000; i++) if (seedHash(`j${i}:reply`) % 4 !== 0) return `j${i}`; throw new Error(); })();
const base = (provider: ReturnType<typeof createFakeProvider>, extra = {}) => ({ persona: bori, provider, input: "삭제해 줘", seed: seedMiss, expected: exp, required: ["reply"], ...extra });

test("extractJson: 순수 JSON·코드펜스·앞뒤 설명·문자열 속 중괄호", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('네, 여기요: {"a":{"b":"}"}} 끝'), { a: { b: "}" } });
  assert.equal(extractJson("JSON 없음"), null);
  assert.equal(extractJson("[1,2]"), null);
  assert.equal(extractJson('{"a":'), null);
});

test("첫 시도에 성공하면 ok, 호출 1번, 시스템 프롬프트에 JSON 안내가 있다", async () => {
  const p = createFakeProvider("p", [], j(okObj));
  const r = await respondJson(base(p));
  assert.equal(r.status, "ok"); assert.equal(r.attempts, 1); assert.equal(p.calls.length, 1);
  assert.deepEqual(r.value, okObj);
  assert.ok(p.calls[0].system.includes("JSON 객체 하나로만"));
});

test("코드펜스로 감싼 응답도 받아들인다", async () => {
  const r = await respondJson(base(createFakeProvider("p", [], "```json\n" + j(okObj) + "\n```")));
  assert.equal(r.status, "ok");
});

test("untouched 필드를 바꾸면 거부하고 재시도, 재시도 메시지에 이유가 담긴다", async () => {
  const p = createFakeProvider("p", [], (req, n) => (n === 0 ? j({ ...okObj, command: "ls" }) : j(okObj)));
  const r = await respondJson(base(p));
  assert.equal(r.status, "ok"); assert.equal(r.attempts, 2);
  const retry = p.calls[1].messages;
  assert.equal(retry.at(-2)!.role, "assistant");
  assert.ok(retry.at(-1)!.content.includes("필드 변경됨: command"));
  assert.equal((r.value as Record<string, unknown>).command, "rm x");
});

test("재시도해도 실패하면 폴백: 값은 expected 로 채우고 말투는 canned→중립 문구 순", async () => {
  const bad = createFakeProvider("p", [], j({ ...okObj, command: "ls" }));
  const r = await respondJson(base(bad, { fallback: { field: "reply", cannedKey: "todo.remaining", vars: { count: 3 }, text: "처리할 수 없어요." } }));
  assert.equal(r.status, "fallback");
  assert.equal(r.attempts, 2); // 1 + 재시도 1
  assert.deepEqual(r.value, { ...exp, reply: "오늘 남은 일은 3개예요." });
  assert.ok(r.status === "fallback" && r.reasons[0].includes("command"));
  const noKey = await respondJson(base(bad, { fallback: { field: "reply", cannedKey: "todo.remaining", text: "처리할 수 없어요." } })); // vars 모자람 → 중립
  assert.deepEqual(noKey.value, { ...exp, reply: "처리할 수 없어요." });
});

test("폴백이 없으면 failed 와 이유를 돌려준다(값은 null)", async () => {
  const r = await respondJson(base(createFakeProvider("p", [], "그냥 말로 답함")));
  assert.equal(r.status, "failed"); assert.equal(r.value, null);
  assert.deepEqual(r.status === "failed" && r.reasons, ["JSON 객체가 아님"]);
});

test("필수 필드가 없으면 거부", async () => {
  const r = await respondJson(base(createFakeProvider("p", [], j({ id: "t1", command: "rm x", status: "pending" })), { maxRetries: 0 }));
  assert.equal(r.status, "failed");
  assert.deepEqual(r.status === "failed" && r.reasons, ["필수 필드 누락: reply"]);
});

test("프로바이더 오류 뒤 재시도로 성공할 수 있다, 계속 실패하면 폴백/실패", async () => {
  const flaky = createFakeProvider("p", [], (_r, n) => (n === 0 ? new Error("timeout") : j(okObj)));
  assert.equal((await respondJson(base(flaky))).status, "ok");
  const down = createFakeProvider("p", [], new Error("401"));
  const r = await respondJson(base(down));
  assert.equal(r.status, "failed");
  assert.deepEqual(r.status === "failed" && r.reasons, ["프로바이더 오류: 401"]);
});

test("maxRetries=0 이면 한 번만 부른다, 잘못된 값은 RangeError", async () => {
  const p = createFakeProvider("p", [], "x");
  await respondJson(base(p, { maxRetries: 0 }));
  assert.equal(p.calls.length, 1);
  await assert.rejects(respondJson(base(p, { maxRetries: -1 })), RangeError);
});

test("flair 는 styledFields 에만: reply 에는 붙고 id·command 는 그대로", async () => {
  const p = createFakeProvider("p", [], j({ ...okObj, reply: "할 일이 있어요." }));
  const r = await respondJson({ ...base(p), seed: seedHit, mood: "happy" });
  assert.equal(r.status, "ok");
  const v = r.value as Record<string, unknown>;
  assert.equal(v.reply, "좋아요, 할 일이 있어요. 화이팅이에요.");
  assert.equal(v.id, "t1"); assert.equal(v.command, "rm x");
});

test("kind=error 이면 reply 에도 flair 를 붙이지 않는다", async () => {
  const p = createFakeProvider("p", [], j({ ...okObj, reply: "실패했어요." }));
  const r = await respondJson({ ...base(p), seed: seedHit, kind: "error", mood: "happy" });
  assert.equal((r.value as Record<string, unknown>).reply, "실패했어요.");
});

test("취소된 신호는 폴백으로 삼키지 않고 오류로 던진다", async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(respondJson(base(createFakeProvider("p", [], "x"), { signal: ac.signal, fallback: { field: "reply", text: "t" } })), /aborted/);
});

test("재시도 때 원래 요청(system·few-shot)이 그대로 유지된다", async () => {
  const p = createFakeProvider("p", [], (_r, n) => (n === 0 ? "깨진 응답" : j(okObj)));
  await respondJson(base(p));
  assert.equal(p.calls[0].system, p.calls[1].system);
  assert.equal(p.calls[0].messages.length, 3, "첫 호출의 기록이 재시도 메시지로 오염되면 안 됨");
  assert.equal(p.calls[1].messages.length, 5);
  assert.deepEqual(p.calls[1].messages.slice(0, 3), p.calls[0].messages);
});
