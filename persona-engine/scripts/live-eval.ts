// 실제 Anthropic API 로 예시 페르소나를 평가한다. 비용이 드는 호출이라 CONFIRM_SPEND=1 없이는 실행되지 않는다.
// 사용: CONFIRM_SPEND=1 node scripts/live-eval.ts [persona.json] [repeats]
// 인증: ANTHROPIC_API_KEY 환경 변수(또는 `ant auth login` 프로필). 키를 인자나 파일에 적지 마세요.
import { readFileSync } from "node:fs";
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "../src/anthropic.ts";
import { runEval } from "../src/index.ts";
import type { Persona } from "../src/index.ts";

const file = process.argv[2] ?? new URL("../examples/bori.persona.json", import.meta.url).pathname;
const repeats = Number(process.argv[3] ?? 3);
const persona: Persona = JSON.parse(readFileSync(file, "utf8"));
const calls = (persona.eval?.probes?.length ?? 0) * repeats;

if (process.env.CONFIRM_SPEND !== "1") {
  console.error(`중단: 실제 API 를 약 ${calls}번 호출합니다(모델 ${DEFAULT_ANTHROPIC_MODEL}, 비용 발생). 확인했다면 CONFIRM_SPEND=1 로 다시 실행하세요.`);
  process.exit(2);
}
const report = await runEval(persona, createAnthropicProvider({ refusalFallback: process.env.NO_FALLBACK !== "1" }), { repeats });
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === "pass" ? 0 : 1);
