# 페르소나 엔진 참고 레포 목록

- 조회일: 2026-11-15 (GitHub 검색 API 결과 그대로. 스타·푸시일은 이후 변동)
- 범위: "생성형 AI 페르소나 엔진"을 만들 때 구조나 아이디어를 참고할 공개 레포
- 주의: 라이선스는 GitHub이 자동 인식한 SPDX 값입니다. `NOASSERTION`은 자동 인식 실패이므로 LICENSE 파일을 직접 읽기 전에는 쓸 수 있다고 판단하지 마세요. 아래 "참고 포인트"는 설명(description)·README 기준이며 코드를 열어 확인한 것이 아닙니다.

## 1. 기준 레포

| 레포 | 스타 | 라이선스(API) | 최종 푸시 | 참고 포인트 |
|---|---:|---|---|---|
| [cheo0y/shisa-agent](https://github.com/cheo0y/shisa-agent) | 101 | NOASSERTION (README는 MIT라고 적음) | 2026-10-27 | 데스크톱 오버레이 비서. 고정 대사(`lines.json`) 중심이고 AI는 선택. 뇌(프로바이더) 추상화, 데몬/UI 분리 구조. 캐릭터 그림은 저작권 때문에 배포에서 제외 |

## 2. 캐릭터·컴패니언 프로젝트

| 레포 | 스타 | 라이선스(API) | 최종 푸시 | 설명(검색 결과) |
|---|---:|---|---|---|
| [moeru-ai/airi](https://github.com/moeru-ai/airi) | 51,458 | MIT | 2026-11-15 | 셀프호스팅 AI 컴패니언 |
| [Open-LLM-VTuber/Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 14,723 | NOASSERTION | 2026-05-15 | 핸즈프리 음성 대화, 음성 끼어들기 |
| [heshengtao/super-agent-party](https://github.com/heshengtao/super-agent-party) | 2,837 | AGPL-3.0 | 2026-10-27 | 올인원 AI 컴패니언(셀프호스팅) |
| [0xAdafang/PersonAi](https://github.com/0xAdafang/PersonAi) | 36 | MIT | 2025-08-25 | 로컬 우선 데스크톱 앱, 페르소나 생성·대화 |

## 3. 롤플레이 프런트엔드·캐릭터 카드

| 레포 | 스타 | 라이선스(API) | 최종 푸시 | 설명 |
|---|---:|---|---|---|
| [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern) | 35,654 | AGPL-3.0 | 2026-11-15 | LLM 프런트엔드. 캐릭터 카드 생태계의 중심 |
| [malfoyslastname/character-card-spec-v2](https://github.com/malfoyslastname/character-card-spec-v2) | 201 | none | 2023-06-22 | AI 캐릭터 카드 스펙 v2 |
| [kwaroran/character-card-spec-v3](https://github.com/kwaroran/character-card-spec-v3) | 114 | MIT | 2024-07-20 | 캐릭터 카드 스펙 v3 |
| [KudoAI/ai-personas](https://github.com/KudoAI/ai-personas) | 26 | none | 2026-08-21 | 페르소나 1,400개 모음. **아카이브됨** |

## 4. 기억(메모리)

| 레포 | 스타 | 라이선스(API) | 최종 푸시 | 설명 |
|---|---:|---|---|---|
| [letta-ai/letta](https://github.com/letta-ai/letta) | 25,451 | Apache-2.0 | 2026-10-18 | 상태를 가진 에이전트와 장기 기억 플랫폼 |
| [NirDiamant/Agent_Memory_Techniques](https://github.com/NirDiamant/Agent_Memory_Techniques) | 1,142 | Apache-2.0 | 2026-11-01 | 에이전트 기억 기법 노트북 30개 |

## 5. 그 밖의 목록

| 레포 | 스타 | 라이선스(API) | 최종 푸시 | 설명 |
|---|---:|---|---|---|
| [DasterProkio/awesome-ai-companion](https://github.com/DasterProkio/awesome-ai-companion) | 1,220 | CC-BY-4.0 | 2026-11-15 | AI 컴패니언 모음 목록. 추가 후보 탐색용 |

## 라이선스 메모
- **AGPL-3.0**(SillyTavern, super-agent-party): 코드를 가져다 쓰면 네트워크로 서비스할 때도 소스 공개 의무가 생깁니다. 제품에 섞기 전에 법무 확인이 필요합니다. 구조 참고만 하는 것은 별개입니다.
- **MIT / Apache-2.0**: 상대적으로 재사용이 쉽지만 저작권 고지는 유지해야 합니다.
- **none**: 라이선스 없음은 "마음대로 써도 됨"이 아니라 기본적으로 재사용 불가입니다.
- **NOASSERTION**: 직접 확인 전까지 보류합니다.
- 캐릭터 IP(치이카와 등 원작)와 Live2D 모델·음성 에셋은 코드 라이선스와 별개입니다.

## 미확인 / 한계
- 위 설명은 검색 결과의 한 줄 설명이며, 각 레포의 코드 품질과 실제 구조는 확인하지 않았습니다.
- `shisa-agent`는 이 세션의 접근 범위 밖이라 라이선스·코드를 직접 읽지 못했습니다.
- 검색어 일부(예: "character persona engine llm", "persona consistency llm agent" 등 스타 필터를 단 질의)는 결과가 없었습니다. **말투 일관성 평가**를 다룬 레포는 이번에 찾지 못했으므로 빈칸입니다.

## 다음 후보 (검색 필요)
- 말투·페르소나 일관성 평가 도구
- 페르소나 스키마/검증 라이브러리
- 프로바이더 추상화 라이브러리
