import { compose } from "./compose.ts";
import { flair } from "./flair.ts";
import type { ProviderAdapter } from "./provider.ts";
import type { MemorySnippet, MessageKind, Mood, Persona } from "./types.ts";

export type RespondInput = {
  persona: Persona;
  provider: ProviderAdapter;
  input: string;
  kind?: MessageKind;
  seed: string;
  mood?: Mood;
  task?: string;
  context?: string;
  memory?: MemorySnippet[];
  model?: string;
  signal?: AbortSignal;
};

/** compose → provider → flair 를 잇는 텍스트 응답 경로. (JSON 출력용 OutputGuard·재시도는 아직 없음) */
export async function respond(i: RespondInput): Promise<string> {
  const kind = i.kind ?? "chat";
  const { system, examples } = compose({ persona: i.persona, kind, task: i.task, context: i.context, memory: i.memory, output: { format: "text" } });
  const text = await i.provider.complete({ system, messages: [...examples, { role: "user", content: i.input }], model: i.model, signal: i.signal });
  return flair(text, i.persona, { seed: i.seed, kind, mood: i.mood });
}
