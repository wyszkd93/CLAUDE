import { pick, seedHash } from "./hash.ts";
import type { MessageKind, Mood, Persona } from "./types.ts";

export const DEFAULT_EVERY_N = 4;
export const DEFAULT_SKIP_KINDS: readonly MessageKind[] = ["error", "approval", "progress"];
const MOOD_ORDER: readonly Mood[] = ["happy", "excited", "calm", "busy"];

export type FlairOpts = { seed: string; kind: MessageKind; mood?: Mood };

/** N번에 한 번(seed 해시로 결정) 감정별 말머리·말꼬리를 붙인다. 진지한 종류에는 붙이지 않는다. */
export function flair(text: string, persona: Persona, o: FlairOpts): string {
  const f = persona.flair;
  if (!f || text === "") return text;
  if ((f.skipKinds ?? DEFAULT_SKIP_KINDS).includes(o.kind)) return text;
  const every = Number.isInteger(f.everyN) && (f.everyN as number) >= 1 ? (f.everyN as number) : DEFAULT_EVERY_N;
  if (seedHash(o.seed) % every !== 0) return text;

  const mood = o.mood ?? MOOD_ORDER.find((m) => (f.lead?.[m]?.length ?? 0) > 0 || (f.tail?.[m]?.length ?? 0) > 0);
  if (!mood) return text;
  const lead = pick(f.lead?.[mood] ?? [], `${o.seed}:lead`) ?? "";
  const tail = pick(f.tail?.[mood] ?? [], `${o.seed}:tail`) ?? "";
  // 이미 같은 말머리/말꼬리로 시작·끝나면 겹쳐 붙이지 않는다
  const l = lead && !text.startsWith(lead.trim()) ? lead : "";
  const t = tail && !text.trimEnd().endsWith(tail.trim()) ? tail : "";
  return `${l}${text}${t}`;
}
