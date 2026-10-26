# 척척 매니저 (카카오톡 봇 + Claude)

카카오톡 봇 웹훅을 받아 Claude로 답을 만들고, 메시지 콜백 API로 답장하는 서버입니다.

```
카톡 메시지 → 카카오 → POST /webhook (즉시 200, 1초 제한)
                         └ 백그라운드: Claude 호출 → POST kapi.kakao.com/v1/bot/callback (콜백 토큰 5분 유효)
```

## 환경변수
| 이름 | 필수 | 설명 |
|---|---|---|
| `KAKAO_BOT_TOKEN` | O | 봇 인증 토큰 (Bot ADMIN_KEY) |
| `ANTHROPIC_API_KEY` | O | Claude API 키 |
| `BOT_MODEL` | | 기본 `claude-opus-5-5` |
| `BOT_EFFORT` | | 기본 `low` (`low`/`medium`/`high`) |
| `WEBHOOK_SECRET` | | 설정 시 `X-Webhook-Secret` 헤더가 일치하는 요청만 처리 (카카오 웹훅 등록의 "헤더 값"에 같은 값 입력) |
| `LOG_RAW_EVENTS` | | 기본 `1` — 수신 이벤트 원문(토큰 마스킹)을 로그에 남김 |

비밀값은 코드나 저장소에 넣지 말고 배포 플랫폼의 환경변수 설정에만 입력합니다.

## 대회 당일 바꿀 곳
- `prompts/system.md` — 역할·응답 규칙
- `knowledge/` — 정제한 데이터(.md/.csv/.txt/.json)를 넣으면 프롬프트에 포함됨 (README는 제외)

## 로컬 실행·테스트
```bash
pip install -r requirements.txt pytest
python -m pytest -q tests
uvicorn app.main:app --port 8000
```

## 배포 (Railway 예시)
1. Railway에서 New Project → Deploy from GitHub repo → 이 저장소·브랜치 선택
2. Settings → Root Directory를 `bot`으로 지정 (Dockerfile 자동 인식)
3. Variables에 `KAKAO_BOT_TOKEN`, `ANTHROPIC_API_KEY` 입력
4. Settings → Networking → Generate Domain → `https://<도메인>/health` 확인
5. 카카오 디벨로퍼스 → 카카오톡 봇 → 봇 → 웹훅 등록에 `https://<도메인>/webhook` 입력
6. 카톡에서 봇에게 메시지를 보내고 Railway 로그의 `event payload=` 줄로 실제 필드명 확인
