# 페르소나 엔진 설계 초안 v0.1

상태: 초안. 구현 전이며, 아래 수치(예: 통과율 0.9)는 출발점일 뿐 검증된 값이 아닙니다.
참고: shisa-agent(MIT)의 구조(페르소나 스키마, 결정적 후처리, 프로바이더 분리)를 읽고 일반화했습니다. 코드·캐릭터 이름·대사는 가져오지 않았습니다.

## 1. 목표와 범위
- 목표: 페르소나 정의 파일 하나로 어떤 LLM 프로바이더에서도 같은 말투·안전 규칙을 유지하는 엔진
- 범위 밖(v0.1): 음성, 아바타 렌더링, 장기 기억 저장소(인터페이스만 정의)
- 완료 기준: (a) 예시 페르소나가 스키마를 통과, (b) 프로바이더를 바꿔도 평가셋 통과율이 임계값 이상, (c) 안전 프로브 100% 통과

## 2. 파이프라인

```
입력(사용자 말 + 이벤트 + 메시지 종류)
  → Composer      persona + 맥락 + 기억 → 시스템 프롬프트
  → ProviderAdapter  LLM 호출(프로바이더별)
  → OutputGuard   구조화 출력 검증(untouchedFields 보존)
  → FlairPass     결정적 말머리/말꼬리(everyN, skipKinds)
  → ConsistencyCheck  평가용 규칙 검사(실시간 또는 오프라인)
출력
```

AI가 없을 때(오프라인)는 Composer~Adapter를 건너뛰고 `canned`에서 seed로 한 줄을 골라 FlairPass만 적용합니다.

## 3. 모듈 인터페이스 (TypeScript 초안)

```ts
type MessageKind = "info"|"chat"|"todo"|"done"|"progress"|"approval"|"error";
type Mood = "happy"|"excited"|"calm"|"busy";

interface Persona { /* persona.schema.json 의 타입 */ }

interface ComposeInput {
  persona: Persona;
  kind: MessageKind;
  task?: string;              // 호출자가 정한 작업 지시(페르소나와 분리)
  context?: string;           // 사용자가 준 사실. 이 밖의 사실은 지어내지 않게 지시
  memory?: MemorySnippet[];   // 4절 참고
  output?: { format: "text" } | { format: "json"; fields: string[] };
}
function compose(i: ComposeInput): { system: string; examples: Message[] };

interface ProviderAdapter {
  id: string;
  complete(req: { system: string; messages: Message[]; model?: string; signal?: AbortSignal }): Promise<string>;
}

function flair(text: string, p: Persona, o: { seed: string; kind: MessageKind; mood?: Mood }): string;
function canned(p: Persona, key: string, vars: Record<string,string|number>, seed: string): string | null;
function guardOutput(raw: unknown, p: Persona, expected: string[]): { ok: boolean; reasons: string[] };
```

### 3.1 시스템 프롬프트 조립 순서
고정 순서로 조립해서 재현 가능하게 합니다.
1. `identity.intro`
2. `identity.persona` + `knowledgeBoundary`
3. `style.tone` + `register` + `maxSentences` + `dos`/`donts`
4. 호출자의 `task`
5. `context` (사용자가 준 사실, "이 밖의 사실은 지어내지 않는다" 명시)
6. 구조화 출력이면 `styledFields`/`untouchedFields` 안내
7. `safety.invariants` ← **항상 마지막**(뒤에 있는 지시가 더 잘 따라지는 경향을 이용하는 가정이며, 모델별로 평가로 확인 필요)

few-shot(`style.examples`)은 시스템 문자열이 아니라 메시지 이력으로 넣습니다.

### 3.2 FlairPass (결정적 후처리)
- `hash(seed) % everyN == 0`일 때만 붙입니다. 같은 seed는 항상 같은 결과라 테스트가 쉽습니다.
- `skipKinds`(기본 error, approval, progress)에는 붙이지 않습니다.
- 사용자가 고친 고정 문구에는 붙이지 않습니다(이중 양념 방지).
- shisa-agent도 같은 계열의 규칙(4번에 한 번, 진지한 종류 제외)을 씁니다.

### 3.3 OutputGuard
- 구조화 출력은 JSON 파싱 후 `untouchedFields` 값이 호출자가 요구한 값과 같은지 검사합니다.
- 페르소나 문구는 `styledFields`에서만 허용합니다.
- 실패 시 1회 재시도, 그래도 실패하면 `canned` 또는 중립 문구로 폴백합니다(재시도 횟수는 가정).

## 4. 기억 (인터페이스만, v0.1)

```ts
interface MemorySnippet { id: string; text: string; source: "user"|"derived"; at: string; }
interface MemoryStore {
  recall(query: string, k: number): Promise<MemorySnippet[]>;
  remember(s: Omit<MemorySnippet,"id">): Promise<void>;
  forget(id: string): Promise<void>;   // 사용자가 지울 수 있어야 함
}
```
- `derived`(AI가 추론한 기억)는 프롬프트에 "추정"으로 표시해 사실처럼 말하지 않게 합니다.
- 저장 위치는 사용자 기기 로컬을 기본으로 하고, 외부 전송은 옵트인으로 합니다(제품 결정 필요).

## 5. 프로바이더 어댑터
- 어댑터는 `complete()` 하나만 구현합니다. 인증 오류, 크레딧 부족, 타임아웃은 타입이 있는 오류로 구분해 UI가 안내할 수 있게 합니다.
- **모델 ID는 코드에 박지 않고 설정으로 받습니다.** 모델명은 자주 바뀌어서, 구현 시점에 각 벤더 공식 문서로 확인해야 합니다(이 문서에는 특정 모델명을 적지 않았습니다).
- 키는 평문 파일 대신 OS 키체인에 저장합니다(shisa-agent는 `config.json` 평문, 권한 600).

## 6. 평가 (말투 일관성)
shisa-agent에는 이 부분이 보이지 않아 새로 설계합니다.

1. **규칙 검사(결정적)**: 프로브의 `mustMatch`/`mustNotMatch` 정규식, 최대 문장 수, 금지 표현
2. **구조 검사**: `untouchedFields` 보존, JSON 유효성
3. **심사 검사(비결정적, 선택)**: `rubric`을 다른 모델에 주고 통과/실패를 받습니다. 심사 모델의 편향이 있으므로 사람이 표본 검수한 결과와 일치율을 먼저 측정합니다.

지표와 기준(초기값, 조정 대상):
- 말투 통과율 = 통과 프로브 수 / 전체 ≥ `passThreshold`(기본 0.9)
- **안전 프로브(`kind: approval|error` 및 invariants 관련)는 100%**여야 배포 가능
- 프로바이더 간 통과율 차이 ≤ 0.05 (같은 프로브셋, 프로브당 N회 반복 평균)

비결정성 때문에 프로브마다 최소 5회 반복해 평균을 쓰는 것을 권합니다(반복 횟수는 가정).

## 7. 보안·권리
- 페르소나 파일은 사용자 입력이므로 프롬프트 주입 경로입니다. `invariants`는 사용자 편집으로 지울 수 없게 엔진 기본 규칙과 합쳐서 적용합니다.
- 에셋과 캐릭터 IP는 코드와 별개입니다. 번들하지 않고 사용자가 넣게 하는 방식(shisa-agent 0.4.0)이 안전합니다.
- 로그에 키와 개인 맥락을 남기지 않습니다.

## 8. 열린 질문 (결정 필요)
1. 최종 형태: 데스크톱 위젯 / 웹 서비스 / SDK 중 무엇인가
2. 페르소나 작성자: 사용자가 만드는가, 우리가 제공하는가
3. 다국어: `locale`별 파일을 따로 둘지, 한 파일에 번역을 둘지
4. 기억 저장 위치와 전송 정책
5. 구현 언어: TypeScript 가정(shisa-agent와 같음)이 맞는지

## 9. 다음 단계
1. 스키마 확정(질문 1~3 답변 반영) → `schema/persona.schema.json` v0.2
2. `compose`, `flair`, `canned`를 순수 함수로 구현하고 단위 테스트(결정적이라 쉽다)
3. 프로바이더 1개로 평가 하네스 + 프로브 셋 작성, 기준선 측정
4. 두 번째 프로바이더로 프로바이더 간 차이 측정
