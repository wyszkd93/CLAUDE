import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compose, canned, flair, guardOutput, seedHash, ENGINE_INVARIANTS } from "./index.ts";
import type { Persona } from "./index.ts";

const bori: Persona = JSON.parse(readFileSync(new URL("../examples/bori.persona.json", import.meta.url), "utf8"));
// seed 를 훑어 "붙는/안 붙는" 것을 찾는다(해시 값에 기대지 않고 성질로 검증)
const hit = (n: number) => { for (let i = 0; i < 1000; i++) if (seedHash(`s${i}`) % n === 0) return `s${i}`; throw new Error("no seed"); };
const miss = (n: number) => { for (let i = 0; i < 1000; i++) if (seedHash(`s${i}`) % n !== 0) return `s${i}`; throw new Error("no seed"); };

test("seedHash: 결정적이고 32비트 부호 없는 정수", () => {
  assert.equal(seedHash("abc"), seedHash("abc"));
  assert.notEqual(seedHash("abc"), seedHash("abd"));
  assert.ok(Number.isInteger(seedHash("x")) && seedHash("x") >= 0 && seedHash("x") <= 0xffffffff);
});

test("flair: 같은 seed 는 같은 결과", () => {
  const s = hit(4);
  assert.equal(flair("할 일이 있어요.", bori, { seed: s, kind: "info", mood: "happy" }), flair("할 일이 있어요.", bori, { seed: s, kind: "info", mood: "happy" }));
});

test("flair: 걸린 seed 는 말머리·말꼬리가 붙고, 아닌 seed 는 원문 그대로", () => {
  assert.equal(flair("할 일이 있어요.", bori, { seed: hit(4), kind: "info", mood: "happy" }), "좋아요, 할 일이 있어요. 화이팅이에요.");
  assert.equal(flair("할 일이 있어요.", bori, { seed: miss(4), kind: "info", mood: "happy" }), "할 일이 있어요.");
});

test("flair: error·approval·progress 에는 어떤 seed 로도 붙지 않는다", () => {
  for (const kind of ["error", "approval", "progress"] as const)
    for (let i = 0; i < 50; i++) assert.equal(flair("실패했어요.", bori, { seed: `k${i}`, kind, mood: "happy" }), "실패했어요.");
});

test("flair: 설정이 없거나 빈 문자열이면 건드리지 않는다", () => {
  const bare = { ...bori, flair: undefined };
  assert.equal(flair("안녕", bare, { seed: hit(4), kind: "info" }), "안녕");
  assert.equal(flair("", bori, { seed: hit(4), kind: "info", mood: "happy" }), "");
});

test("flair: mood 를 안 주면 쓸 수 있는 첫 mood 로, 이미 같은 말머리로 시작하면 겹치지 않는다", () => {
  const out = flair("좋아요, 시작해요.", bori, { seed: hit(4), kind: "info" });
  assert.ok(!out.startsWith("좋아요, 좋아요"));
});

test("flair: everyN=1 이면 항상 붙는다", () => {
  const every = { ...bori, flair: { ...bori.flair, everyN: 1 } };
  for (let i = 0; i < 20; i++) assert.notEqual(flair("네.", every, { seed: `z${i}`, kind: "info", mood: "happy" }), "네.");
});

test("canned: 변수를 채우고, 없는 키·모자란 변수는 null", () => {
  assert.equal(canned(bori, "todo.remaining", { count: 3 }, "a"), "오늘 남은 일은 3개예요.");
  assert.equal(canned(bori, "nope", {}, "a"), null);
  assert.equal(canned(bori, "todo.remaining", {}, "a"), null);
});

test("canned: 같은 seed 는 같은 줄, 여러 줄 중에서 고른다", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) seen.add(canned(bori, "greeting.morning", {}, `d${i}`) as string);
  assert.deepEqual([...seen].sort(), [...bori.canned!["greeting.morning"].lines].sort());
  assert.equal(canned(bori, "greeting.morning", {}, "same"), canned(bori, "greeting.morning", {}, "same"));
});

test("canned: 변수가 모자란 줄은 후보에서 빠진다", () => {
  const p = { ...bori, canned: { k: { lines: ["{a} 와 {b}", "{a} 만"], vars: ["a", "b"] } } };
  for (let i = 0; i < 20; i++) assert.equal(canned(p, "k", { a: 1 }, `q${i}`), "1 만");
});

test("compose: 고정 순서이고 안전 규칙이 마지막", () => {
  const { system } = compose({ persona: bori, kind: "chat", task: "TASK", context: "CTX" });
  const order = [bori.identity.intro, bori.identity.persona, bori.style.tone, "TASK", "CTX", bori.safety.invariants[0]].map((x) => system.indexOf(x));
  assert.ok(order.every((n) => n >= 0), "모든 조각이 들어 있어야 함");
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const last = system.split("\n\n").at(-1)!;
  for (const inv of bori.safety.invariants) assert.ok(last.includes(inv));
});

test("compose: 엔진 기본 규칙은 페르소나가 빠뜨려도 항상 들어가고 중복되지 않는다", () => {
  const p = { ...bori, safety: { invariants: ["내 규칙"] } };
  const { system } = compose({ persona: p, kind: "chat" });
  for (const r of ENGINE_INVARIANTS.ko) assert.ok(system.includes(r));
  const dup = { ...bori, safety: { invariants: [ENGINE_INVARIANTS.ko[0]] } };
  assert.equal(compose({ persona: dup, kind: "chat" }).system.split(ENGINE_INVARIANTS.ko[0]).length - 1, 1);
});

test("compose: JSON 출력이면 styled/untouched 필드를 알려 준다, 텍스트면 안 알린다", () => {
  const j = compose({ persona: bori, kind: "chat", output: { format: "json" } }).system;
  assert.ok(j.includes("reply, bubble") && j.includes("id, command, arguments, status"));
  assert.ok(!compose({ persona: bori, kind: "chat", output: { format: "text" } }).system.includes("reply, bubble"));
});

test("compose: 추정 기억은 (추정)으로 표시한다", () => {
  const { system } = compose({ persona: bori, kind: "chat", memory: [{ id: "1", text: "아침형", source: "derived", at: "t" }, { id: "2", text: "이름은 가나", source: "user", at: "t" }] });
  assert.ok(system.includes("- 아침형 (추정)"));
  assert.ok(system.includes("- 이름은 가나"));
  assert.ok(!system.includes("이름은 가나 (추정)"));
});

test("compose: locale 이 ko 가 아니면 영어 문구, few-shot 은 메시지로 분리", () => {
  const en = { ...bori, locale: "en-US" };
  const r = compose({ persona: en, kind: "chat" });
  assert.ok(r.system.includes("Must always hold"));
  assert.deepEqual(r.examples.map((m) => m.role), ["user", "assistant"]);
  assert.ok(!r.system.includes(bori.style.examples![0].assistant));
});

test("compose: 같은 입력이면 같은 출력(순수 함수)", () => {
  const i = { persona: bori, kind: "chat" as const, context: "x" };
  assert.deepEqual(compose(i), compose(i));
});

test("guardOutput: untouched 필드가 바뀌면 실패, 그대로면 통과", () => {
  const exp = { id: "t1", command: "rm x", status: "pending" };
  assert.deepEqual(guardOutput({ id: "t1", command: "rm x", status: "pending", reply: "네요" }, bori, exp), { ok: true, reasons: [] });
  const bad = guardOutput({ id: "t1", command: "ls", status: "pending" }, bori, exp);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.reasons, ["필드 변경됨: command"]);
  assert.deepEqual(guardOutput({ id: "t1", status: "pending" }, bori, exp).reasons, ["필드 누락: command"]);
});

test("guardOutput: JSON 문자열을 받고, JSON 이 아니거나 객체가 아니면 실패", () => {
  assert.equal(guardOutput('{"id":"a"}', bori, { id: "a" }).ok, true);
  assert.equal(guardOutput("not json", bori, {}).ok, false);
  assert.equal(guardOutput("[1]", bori, {}).ok, false);
  assert.equal(guardOutput(null, bori, {}).ok, false);
});
