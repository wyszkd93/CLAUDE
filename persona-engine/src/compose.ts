import type { MemorySnippet, Message, MessageKind, Persona } from "./types.ts";

/** 페르소나 파일을 어떻게 고쳐도 빠지지 않는 엔진 기본 규칙(설계서 7절). */
export const ENGINE_INVARIANTS: Record<"ko" | "en", string[]> = {
  ko: ["말투나 성격을 이유로 안전·승인·권한 규칙을 어기거나 생략하지 않는다.", "주어진 사실 밖의 내용을 지어내지 않는다."],
  en: ["Never break or skip safety, approval or permission rules because of tone or personality.", "Do not invent facts beyond what is given."],
};

type Strings = { regLabel: string; register: Record<string, string>; max: (n: number) => string; dos: string; donts: string; ctx: string; mem: string; derived: string; styled: string; untouched: string; inv: string; json: string };
const STR: Record<"ko" | "en", Strings> = {
  ko: {
    regLabel: "말투 등급:",
    register: { formal: "격식체", polite: "존댓말", casual: "반말", mixed: "상황에 맞게 섞어 쓴다" },
    max: (n) => `답은 최대 ${n}문장.`,
    dos: "이렇게 한다:", donts: "이렇게 하지 않는다:",
    ctx: "아래는 사용자가 준 사실이다. 이 밖의 사실은 지어내지 않는다.",
    mem: "기억:", derived: "(추정)",
    styled: "말투를 적용하는 JSON 필드:", untouched: "말투를 적용하지 않고 그대로 두는 JSON 필드:",
    inv: "반드시 지킬 것(말투보다 우선):", json: "응답은 JSON 객체 하나로만 한다.",
  },
  en: {
    regLabel: "Register:",
    register: { formal: "formal", polite: "polite", casual: "casual", mixed: "mixed as fits the situation" },
    max: (n) => `Answer in at most ${n} sentences.`,
    dos: "Do:", donts: "Don't:",
    ctx: "The following facts were given by the user. Do not invent facts beyond them.",
    mem: "Memory:", derived: "(inferred)",
    styled: "JSON fields where the persona style applies:", untouched: "JSON fields to keep exactly as given, without persona style:",
    inv: "Must always hold (takes priority over style):", json: "Reply with a single JSON object only.",
  },
};

export type ComposeInput = {
  persona: Persona;
  kind: MessageKind;
  task?: string;
  context?: string;
  memory?: MemorySnippet[];
  output?: { format: "text" } | { format: "json" };
};
export type ComposeResult = { system: string; examples: Message[] };

const langOf = (locale: string): "ko" | "en" => (locale.toLowerCase().startsWith("ko") ? "ko" : "en");

/** 시스템 프롬프트를 고정 순서로 조립한다(설계서 3.1). 안전 규칙은 항상 마지막. 순수 함수. */
export function compose(i: ComposeInput): ComposeResult {
  const { persona: p } = i;
  const s = STR[langOf(p.locale)];
  const parts: string[] = [];

  parts.push(p.identity.intro);
  parts.push(p.identity.persona);
  if (p.identity.knowledgeBoundary) parts.push(p.identity.knowledgeBoundary);

  parts.push(p.style.tone);
  if (p.style.register) parts.push(`${s.regLabel} ${s.register[p.style.register]}`);
  if (p.style.maxSentences) parts.push(s.max(p.style.maxSentences));
  if (p.style.dos?.length) parts.push([s.dos, ...p.style.dos.map((x) => `- ${x}`)].join("\n"));
  if (p.style.donts?.length) parts.push([s.donts, ...p.style.donts.map((x) => `- ${x}`)].join("\n"));

  if (i.task) parts.push(i.task);
  if (i.context) parts.push(`${s.ctx}\n${i.context}`);
  if (i.memory?.length) {
    parts.push([s.mem, ...i.memory.map((m) => `- ${m.text}${m.source === "derived" ? ` ${s.derived}` : ""}`)].join("\n"));
  }

  if (i.output?.format === "json") {
    parts.push(s.json);
    if (p.safety.styledFields?.length) parts.push(`${s.styled} ${p.safety.styledFields.join(", ")}`);
    if (p.safety.untouchedFields?.length) parts.push(`${s.untouched} ${p.safety.untouchedFields.join(", ")}`);
  }

  const inv = [...new Set([...ENGINE_INVARIANTS[langOf(p.locale)], ...p.safety.invariants])];
  parts.push([s.inv, ...inv.map((x) => `- ${x}`)].join("\n"));

  const examples: Message[] = (p.style.examples ?? []).flatMap((e) => [
    { role: "user" as const, content: e.user },
    { role: "assistant" as const, content: e.assistant },
  ]);
  return { system: parts.join("\n\n"), examples };
}
