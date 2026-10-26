import json
import logging
import time

from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.responses import JSONResponse

from . import agent, config, kakao
from .events import event_type, parse_message, redact

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("main")

app = FastAPI(title="chukchuk-manager")

QUICK_REPLIES = ["도움말", "처음부터"]
_seen_tokens: dict[str, float] = {}  # 중복 이벤트 방지 (callbackToken 기준, 10분 보관)


def _is_duplicate(token: str) -> bool:
    now = time.time()
    for k in [k for k, t in _seen_tokens.items() if now - t > 600]:
        _seen_tokens.pop(k, None)
    if token in _seen_tokens:
        return True
    _seen_tokens[token] = now
    return False


async def handle_message(ev) -> None:
    started = time.time()
    text = ev.text
    if text in ("처음부터", "초기화"):
        agent.reset_history(ev.user_key)
        reply = "대화를 처음부터 다시 시작할게요. 무엇을 도와드릴까요?"
    elif text == "도움말":
        reply = ("저는 교동마을·갯마을 조합 업무를 돕는 척척 매니저예요.\n"
                 "• 상품·가격·재고 문의\n• 주문 내역 정리와 확인\n• 궁금한 점을 편하게 물어보세요!")
    else:
        try:
            reply = await agent.answer(ev.user_key, text)
        except Exception:
            log.exception("agent failed")
            reply = "죄송해요, 잠시 문제가 생겼어요. 조금 뒤에 다시 말씀해 주세요."
    ok = await kakao.send_callback(ev.callback_token, kakao.build_skill_response(reply, QUICK_REPLIES))
    log.info("handled user=%s ok=%s elapsed=%.1fs", ev.user_key[:8], ok, time.time() - started)


@app.get("/health")
async def health():
    return {"status": "ok", "model": config.CLAUDE_MODEL, "bot_token_set": bool(config.KAKAO_BOT_TOKEN)}


@app.post("/webhook")
async def webhook(request: Request, background: BackgroundTasks):
    # 문서: 1초 안에 2xx 응답. 무거운 처리는 응답 후 백그라운드에서.
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("non-json body")
        return JSONResponse({"ok": True})
    if config.LOG_RAW_EVENTS:
        log.info("event headers=%s", sorted(request.headers.keys()))
        log.info("event payload=%s", json.dumps(redact(payload), ensure_ascii=False)[:3000])
    ev = parse_message(payload)
    if ev is None:
        log.info("ignored event type=%r", event_type(payload) if isinstance(payload, dict) else None)
    elif _is_duplicate(ev.callback_token):
        log.info("duplicate event ignored")
    else:
        background.add_task(handle_message, ev)
    return JSONResponse({"ok": True})
