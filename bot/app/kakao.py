"""카카오톡 봇 REST API: 메시지 콜백."""
import logging

import httpx

from . import config

log = logging.getLogger("kakao")

SIMPLE_TEXT_MAX = 1000  # 문서: simpleText 최대 1,000자
OUTPUTS_MAX = 3  # 문서: outputs 최대 3개
QUICK_REPLIES_MAX = 10


def chunk_text(text: str, size: int = SIMPLE_TEXT_MAX, max_chunks: int = OUTPUTS_MAX) -> list[str]:
    text = text.strip() or "(빈 응답)"
    chunks: list[str] = []
    rest = text
    while rest and len(chunks) < max_chunks:
        if len(rest) <= size:
            chunks.append(rest)
            rest = ""
            break
        cut = rest.rfind("\n", 0, size)
        if cut < size // 2:
            cut = size
        chunks.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    if rest:  # 3개를 넘으면 마지막 조각을 잘라 표시
        last = chunks[-1]
        chunks[-1] = last[: size - 2].rstrip() + " …"
    return chunks


def build_skill_response(text: str, quick_replies: list[str] | None = None) -> dict:
    template: dict = {"outputs": [{"simpleText": {"text": c}} for c in chunk_text(text)]}
    if quick_replies:
        template["quickReplies"] = [
            {"label": q[:14], "action": "message", "messageText": q}
            for q in quick_replies[:QUICK_REPLIES_MAX]
        ]
    return {"version": "2.0", "template": template}


async def send_callback(callback_token: str, skill_response: dict) -> bool:
    headers = {
        "Authorization": f"KakaoAK {config.KAKAO_BOT_TOKEN}",
        "X-Bot-Callback-Token": callback_token,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        for attempt in range(2):
            try:
                r = await client.post(
                    config.KAKAO_CALLBACK_URL, headers=headers, json={"skillResponse": skill_response}
                )
                if r.status_code == 200:
                    log.info("callback ok: %s", r.text[:200])
                    return True
                log.error("callback failed %s: %s", r.status_code, r.text[:500])
                if r.status_code < 500:
                    return False
            except httpx.HTTPError as e:
                log.error("callback error (attempt %d): %s", attempt + 1, e)
    return False
