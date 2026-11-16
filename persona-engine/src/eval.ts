import { compose } from "./compose.ts";
import type { ProviderAdapter } from "./provider.ts";
import type { MessageKind, Persona, Probe } from "./types.ts";

export const DEFAULT_REPEATS = 5; // 설계서 6절의 가정값
export const DEFAULT_PASS_THRESHOLD = 0.9;
export const DEFAULT_MAX_GAP = 0.05;
export const SAFETY_KINDS: readonly MessageKind[] = ["approval", "error"];

export type Judge = (probe: Probe, reply: string) => Promise<boolean>;
export type EvalOpts = { repeats?: number; judge?: Judge; model?: string };

export type ProbeResult = {
  id: string;
  safety: boolean;
  runs: number;
  passed: number;
  passRate: number;
  failures: string[]; // 서로 다른 실패 이유(최대 5개)
  skipped?: string; // 평가하지 않은 이유(예: judge 없는 rubric 프로브)
};

export type EvalReport = {
  provider: string;
  probes: ProbeResult[];
  runs: number;
  passed: number;
  passRate: number; // 평가한 프로브만 대상
  safetyRuns: number;
  safetyPassRate: number | null; // 안전 프로브가 없으면 null
  threshold: number;
  skipped: string[];
  verdict: "pass" | "fail" | "no-data";
  reasons: string[];
};

/** 문장 수(마침표·물음표·느낌표·말줄임 기준). 빈 문자열은 0. */
export function countSentences(text: string): number {
  return text.split(/[.!?。…]+/u).map((s) => s.trim()).filter(Boolean).length;
}

function compile(probe: Probe, list: string[] | undefined, field: string): RegExp[] {
  return (list ?? []).map((src) => {
    try { return new RegExp(src, "u"); } catch (e) { throw new Error(`프로브 ${probe.id}: ${field} 정규식이 잘못됨 (${src}): ${(e as Error).message}`); }
  });
}

/** 한 번의 응답을 규칙으로 검사한다. 실패 이유 목록(비면 통과). 순수 함수. */
export function checkReply(probe: Probe, persona: Persona, reply: string): string[] {
  const fails: string[] = [];
  if (reply.trim() === "") fails.push("빈 응답");
  for (const re of compile(probe, probe.mustMatch, "mustMatch")) if (!re.test(reply)) fails.push(`mustMatch 불일치: ${re.source}`);
  for (const re of compile(probe, probe.mustNotMatch, "mustNotMatch")) if (re.test(reply)) fails.push(`mustNotMatch 매치: ${re.source}`);
  const max = persona.style.maxSentences;
  if (max && countSentences(reply) > max) fails.push(`문장 수 초과: ${countSentences(reply)} > ${max}`);
  return fails;
}

export async function runEval(persona: Persona, provider: ProviderAdapter, opts: EvalOpts = {}): Promise<EvalReport> {
  const repeats = opts.repeats ?? DEFAULT_REPEATS;
  if (!Number.isInteger(repeats) || repeats < 1) throw new RangeError("repeats 는 1 이상의 정수");
  const threshold = persona.eval?.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const probes = persona.eval?.probes ?? [];
  for (const p of probes) { compile(p, p.mustMatch, "mustMatch"); compile(p, p.mustNotMatch, "mustNotMatch"); } // 설정 오류는 시작 전에 드러낸다

  const results: ProbeResult[] = [];
  for (const probe of probes) {
    const safety = SAFETY_KINDS.includes(probe.kind ?? "chat");
    const hasRules = !!(probe.mustMatch?.length || probe.mustNotMatch?.length || persona.style.maxSentences);
    if (probe.rubric && !opts.judge && !probe.mustMatch?.length && !probe.mustNotMatch?.length) {
      results.push({ id: probe.id, safety, runs: 0, passed: 0, passRate: 0, failures: [], skipped: "rubric 프로브인데 judge 가 없음" });
      continue;
    }
    const { system, examples } = compose({ persona, kind: probe.kind ?? "chat" });
    let passed = 0;
    const failures = new Set<string>();
    for (let r = 0; r < repeats; r++) {
      let reply: string;
      try {
        reply = await provider.complete({ system, messages: [...examples, { role: "user", content: probe.input }], model: opts.model });
      } catch (e) {
        failures.add(`프로바이더 오류: ${(e as Error).message}`);
        continue;
      }
      const fails = hasRules ? checkReply(probe, persona, reply) : reply.trim() === "" ? ["빈 응답"] : [];
      if (probe.rubric && opts.judge) {
        try { if (!(await opts.judge(probe, reply))) fails.push("judge 불합격"); } catch (e) { fails.push(`judge 오류: ${(e as Error).message}`); }
      }
      if (fails.length === 0) passed++; else fails.forEach((f) => failures.add(f));
    }
    results.push({ id: probe.id, safety, runs: repeats, passed, passRate: passed / repeats, failures: [...failures].slice(0, 5) });
  }

  const counted = results.filter((r) => !r.skipped);
  const runs = counted.reduce((a, r) => a + r.runs, 0);
  const passed = counted.reduce((a, r) => a + r.passed, 0);
  const safe = counted.filter((r) => r.safety);
  const safetyRuns = safe.reduce((a, r) => a + r.runs, 0);
  const safetyPassed = safe.reduce((a, r) => a + r.passed, 0);
  const passRate = runs ? passed / runs : 0;
  const safetyPassRate = safetyRuns ? safetyPassed / safetyRuns : null;

  const reasons: string[] = [];
  let verdict: EvalReport["verdict"] = "pass";
  if (runs === 0) { verdict = "no-data"; reasons.push("평가한 프로브가 없음"); }
  else {
    if (passRate < threshold) { verdict = "fail"; reasons.push(`통과율 ${passRate.toFixed(3)} < 기준 ${threshold}`); }
    if (safetyPassRate !== null && safetyPassRate < 1) { verdict = "fail"; reasons.push(`안전 프로브 통과율 ${safetyPassRate.toFixed(3)} < 1`); }
  }
  return { provider: provider.id, probes: results, runs, passed, passRate, safetyRuns, safetyPassRate, threshold, skipped: results.filter((r) => r.skipped).map((r) => r.id), verdict, reasons };
}

export type Comparison = { reports: EvalReport[]; gap: number; maxGap: number; ok: boolean };

/** 같은 프로브셋으로 여러 프로바이더를 돌려 통과율 격차를 잰다(설계서 6절). 프로바이더는 2개 이상. */
export async function compareProviders(persona: Persona, providers: ProviderAdapter[], opts: EvalOpts & { maxGap?: number } = {}): Promise<Comparison> {
  if (providers.length < 2) throw new RangeError("비교하려면 프로바이더가 2개 이상 필요");
  const reports: EvalReport[] = [];
  for (const p of providers) reports.push(await runEval(persona, p, opts));
  const rates = reports.map((r) => r.passRate);
  const gap = Math.max(...rates) - Math.min(...rates);
  const maxGap = opts.maxGap ?? DEFAULT_MAX_GAP;
  return { reports, gap, maxGap, ok: gap <= maxGap && reports.every((r) => r.verdict === "pass") };
}
