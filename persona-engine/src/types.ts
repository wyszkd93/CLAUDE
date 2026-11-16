// persona.schema.json 의 타입. 스키마를 바꾸면 여기도 함께 바꾼다.
export type MessageKind = "info" | "chat" | "todo" | "done" | "progress" | "approval" | "error";
export type Mood = "happy" | "excited" | "calm" | "busy";
export type MoodLines = Partial<Record<Mood, string[]>>;

export type Persona = {
  schemaVersion: "0.1";
  id: string;
  name: string;
  locale: string;
  identity: { intro: string; persona: string; knowledgeBoundary?: string };
  style: {
    tone: string;
    register?: "formal" | "polite" | "casual" | "mixed";
    maxSentences?: number;
    dos?: string[];
    donts?: string[];
    examples?: { user: string; assistant: string; context?: string }[];
  };
  flair?: { everyN?: number; lead?: MoodLines; tail?: MoodLines; skipKinds?: MessageKind[] };
  canned?: Record<string, { lines: string[]; vars?: string[] }>;
  safety: { invariants: string[]; styledFields?: string[]; untouchedFields?: string[] };
};

export type Message = { role: "user" | "assistant"; content: string };
export type MemorySnippet = { id: string; text: string; source: "user" | "derived"; at: string };
