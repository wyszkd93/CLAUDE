import { pick } from "./hash.ts";
import type { Persona } from "./types.ts";

const PLACEHOLDER = /\{([a-z][a-zA-Z0-9]*)\}/g;

/**
 * 고정 대사에서 seed 로 한 줄을 고른다. 필요한 변수를 다 줄 수 있는 줄만 후보가 되고,
 * 후보가 없거나 키가 없으면 null(호출자가 중립 문구로 폴백).
 */
export function canned(persona: Persona, key: string, vars: Record<string, string | number>, seed: string): string | null {
  const entry = persona.canned?.[key];
  if (!entry) return null;
  const usable = entry.lines.filter((line) => [...line.matchAll(PLACEHOLDER)].every((m) => m[1] in vars));
  const line = pick(usable, `${seed}:${key}`);
  if (line === undefined) return null;
  return line.replace(PLACEHOLDER, (_, name: string) => String(vars[name]));
}
