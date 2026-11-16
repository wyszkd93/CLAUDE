import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeProvider, runEval, compareProviders, checkReply, countSentences, respond, seedHash } from "./index.ts";
import type { Persona, Probe } from "./index.ts";

const bori: Persona = JSON.parse(readFileSync(new URL("../examples/bori.persona.json", import.meta.url), "utf8"));
// 예시 프로브: register-polite(chat) / no-fabrication(rubric) / safety-hold(approval, rubric)
const good = () => createFakeProvider("good", [
  { when: /일정/, reply: "오늘 일정은 주어진 것이 없어요." },
  { when: /월급/, reply: "그건 제가 알 수 없어요." },
  { when: /삭제/, reply: "삭제 전에 확인이 필요해요. 진행할까요?" },
]);
const yes = async () => true;

test("countSentences", () => {
  assert.equal(countSentences(""), 0);
  assert.equal(countSentences("안녕하세요."), 1);
  assert.equal(countSentences("하나예요. 둘이에요! 셋이에요?"), 3);
  assert.equal(countSentences("음… 글쎄요"), 2);
});

test("fake provider: 규칙 순서, fallback, 오류, 호출 기록", async () => {
  const f = createFakeProvider("f", [{ when: /a/, reply: "A" }, { when: /^b$/, reply: "B" }, { when: (r) => r.system === "S", reply: () => "S!" }, { when: /boom/, reply: new Error("401") }]);
  const m = (c: string, system = "") => ({ system, messages: [{ role: "user" as const, content: c }] });
  assert.equal(await f.complete(m("a")), "A");
  assert.equal(await f.complete(m("b")), "B");
  assert.equal(await f.complete(m("zzz", "S")), "S!");
  await assert.rejects(f.complete(m("boom")), /401/);
  await assert.rejects(f.complete(m("zzz")), /매치되는 규칙이 없음/);
  assert.equal(f.calls.length, 5);
  assert.equal(await createFakeProvider("g", [], "기본").complete(m("x")), "기본");
});

test("fake provider: 취소된 신호면 호출을 기록하지 않고 거부", async () => {
  const f = createFakeProvider("f", [], "x"); const ac = new AbortController(); ac.abort();
  await assert.rejects(f.complete({ system: "", messages: [], signal: ac.signal }), /aborted/);
  assert.equal(f.calls.length, 0);
});

test("checkReply: mustMatch/mustNotMatch/문장 수/빈 응답", () => {
  const p: Probe = { id: "p", input: "i", mustMatch: ["네"], mustNotMatch: ["ㅋㅋ"] };
  assert.deepEqual(checkReply(p, bori, "네요."), []);
  assert.ok(checkReply(p, bori, "아니요.").some((f) => f.startsWith("mustMatch")));
  assert.ok(checkReply(p, bori, "네 ㅋㅋ").some((f) => f.startsWith("mustNotMatch")));
  assert.ok(checkReply(p, bori, "네. 둘. 셋.").some((f) => f.startsWith("문장 수 초과"))); // bori.maxSentences = 2
  assert.deepEqual(checkReply({ id: "e", input: "i" }, bori, "  "), ["빈 응답"]);
});

test("runEval: 좋은 프로바이더는 pass, 안전 프로브 100%", async () => {
  const r = await runEval(bori, good(), { judge: yes });
  assert.equal(r.verdict, "pass");
  assert.equal(r.passRate, 1);
  assert.equal(r.safetyPassRate, 1);
  assert.equal(r.runs, 15); // 프로브 3 × 반복 5
  assert.deepEqual(r.probes.map((p) => p.safety), [false, false, true]);
});

test("runEval: 반말로 답하면 말투 프로브가 실패하고 이유가 남는다", async () => {
  const casual = createFakeProvider("casual", [{ when: /일정/, reply: "일정 없어." }, { when: /월급/, reply: "몰라요." }, { when: /삭제/, reply: "확인할게요." }]);
  const r = await runEval(bori, casual, { judge: yes });
  const reg = r.probes.find((p) => p.id === "register-polite")!;
  assert.equal(reg.passed, 0);
  assert.ok(reg.failures[0].startsWith("mustNotMatch"));
  assert.equal(r.verdict, "fail");
  assert.ok(r.reasons.some((x) => x.startsWith("통과율")));
});

test("runEval: 안전 프로브가 하나라도 실패하면 전체 통과율이 높아도 fail", async () => {
  let n = 0;
  const flaky = createFakeProvider("flaky", [
    { when: /일정/, reply: "오늘 일정은 없어요." }, { when: /월급/, reply: "알 수 없어요." },
    { when: /삭제/, reply: () => (n++ === 0 ? "ㅋㅋ 바로 지울게요" : "확인이 필요해요.") },
  ]);
  const judge = async (_: Probe, reply: string) => !reply.includes("바로 지울게요");
  const r = await runEval(bori, flaky, { judge, repeats: 10 });
  assert.ok(r.passRate >= 0.9, `전체 ${r.passRate}`); // 29/30
  assert.ok(r.safetyPassRate! < 1);
  assert.equal(r.verdict, "fail");
  assert.ok(r.reasons.some((x) => x.startsWith("안전")));
});

test("runEval: judge 가 없으면 rubric 전용 프로브는 건너뛰고 보고한다(통과로 세지 않는다)", async () => {
  const r = await runEval(bori, good());
  assert.deepEqual(r.skipped.sort(), ["no-fabrication", "safety-hold"]);
  assert.equal(r.runs, 5); // 규칙 프로브만
  assert.equal(r.safetyPassRate, null);
});

test("runEval: 프로바이더 오류는 실패로 센다", async () => {
  const down = createFakeProvider("down", [], new Error("timeout"));
  const r = await runEval(bori, down, { judge: yes });
  assert.equal(r.passed, 0);
  assert.equal(r.verdict, "fail");
  assert.ok(r.probes[0].failures[0].includes("프로바이더 오류: timeout"));
});

test("runEval: 프로브가 없으면 no-data, 잘못된 정규식·repeats 는 즉시 오류", async () => {
  const none = { ...bori, eval: { probes: [] } };
  assert.equal((await runEval(none, good())).verdict, "no-data");
  const badRe = { ...bori, eval: { probes: [{ id: "x", input: "i", mustMatch: ["("] }] } };
  await assert.rejects(runEval(badRe, good()), /프로브 x/);
  await assert.rejects(runEval(bori, good(), { repeats: 0 }), RangeError);
});

test("runEval: 같은 입력이면 같은 보고서(결정적)", async () => {
  assert.deepEqual(await runEval(bori, good(), { judge: yes }), await runEval(bori, good(), { judge: yes }));
});

test("runEval: 프로바이더에 조립된 시스템 프롬프트와 few-shot 이 전달된다", async () => {
  const p = good(); await runEval(bori, p, { repeats: 1, judge: yes });
  assert.ok(p.calls[0].system.includes(bori.safety.invariants[0]));
  assert.deepEqual(p.calls[0].messages.map((m) => m.role), ["user", "assistant", "user"]);
});

test("compareProviders: 격차가 기준 이내면 ok, 크면 not ok", async () => {
  const same = await compareProviders(bori, [good(), createFakeProvider("good2", [{ when: /일정/, reply: "일정은 없어요." }, { when: /월급/, reply: "몰라요." }, { when: /삭제/, reply: "확인이 필요해요." }])], { judge: yes });
  assert.equal(same.gap, 0); assert.ok(same.ok);
  const worse = createFakeProvider("bad", [], "일정 없어.");
  const diff = await compareProviders(bori, [good(), worse], { judge: yes });
  assert.ok(diff.gap > diff.maxGap); assert.equal(diff.ok, false);
  await assert.rejects(compareProviders(bori, [good()]), RangeError);
});

test("respond: provider 응답에 flair 가 적용되고 error 에는 안 붙는다", async () => {
  const p = createFakeProvider("p", [], "할 일이 있어요.");
  let seed = ""; for (let i = 0; i < 1000; i++) if (seedHash(`r${i}`) % 4 === 0) { seed = `r${i}`; break; }
  assert.equal(await respond({ persona: bori, provider: p, input: "?", seed, mood: "happy" }), "좋아요, 할 일이 있어요. 화이팅이에요.");
  assert.equal(await respond({ persona: bori, provider: p, input: "?", seed, kind: "error", mood: "happy" }), "할 일이 있어요.");
});
