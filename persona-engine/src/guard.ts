import type { Persona } from "./types.ts";

export type GuardResult = { ok: boolean; reasons: string[] };

/**
 * 구조화 출력 검사. untouchedFields 중 호출자가 기대값을 준 필드는 한 글자도 달라지면 안 되고,
 * 문자열이 아니거나 JSON 이 아니면 실패한다. (페르소나 문구는 styledFields 에서만 허용)
 */
export function guardOutput(raw: unknown, persona: Persona, expected: Record<string, unknown>): GuardResult {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return { ok: false, reasons: ["JSON 이 아님"] }; }
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reasons: ["객체가 아님"] };
  const rec = obj as Record<string, unknown>;
  const reasons: string[] = [];
  for (const f of persona.safety.untouchedFields ?? []) {
    if (!(f in expected)) continue;
    if (!(f in rec)) reasons.push(`필드 누락: ${f}`);
    else if (JSON.stringify(rec[f]) !== JSON.stringify(expected[f])) reasons.push(`필드 변경됨: ${f}`);
  }
  return { ok: reasons.length === 0, reasons };
}
