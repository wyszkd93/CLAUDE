"""카카오톡 봇 DISPATCH 이벤트 파싱.

문서로 확인된 것: op=DISPATCH, 메시지 이벤트 MESSAGE_CREATE, 콜백 토큰은 d.callbackToken.
발화 텍스트/사용자 키의 정확한 필드명은 문서에 없어 후보 경로를 순서대로 시도한다.
실제 페이로드를 로그로 확인한 뒤 후보 목록을 확정할 것.
"""
from dataclasses import dataclass
from typing import Any

TEXT_PATHS = [
    ("message", "text"),
    ("message", "content"),
    ("text",),
    ("content",),
    ("utterance",),
    ("userRequest", "utterance"),
]
USER_PATHS = [
    ("botUserKey",),
    ("user", "botUserKey"),
    ("author", "botUserKey"),
    ("user", "id"),
    ("author", "id"),
    ("userRequest", "user", "id"),
]
ROOM_PATHS = [("botGroupKey",), ("chat", "id"), ("room", "id"), ("channelId",)]


@dataclass
class MessageEvent:
    callback_token: str
    text: str
    user_key: str
    room_key: str
    event_type: str


def _dig(obj: Any, path: tuple) -> Any:
    for key in path:
        if not isinstance(obj, dict) or key not in obj:
            return None
        obj = obj[key]
    return obj


def _first_str(obj: Any, paths: list) -> str:
    for p in paths:
        v = _dig(obj, p)
        if isinstance(v, (str, int)) and str(v).strip():
            return str(v)
    return ""


def event_type(payload: dict) -> str:
    return str(payload.get("t") or payload.get("type") or payload.get("event") or "")


def parse_message(payload: dict) -> MessageEvent | None:
    """답장이 필요한 메시지 이벤트면 MessageEvent, 아니면 None."""
    if not isinstance(payload, dict):
        return None
    op = payload.get("op")
    if op not in (None, "DISPATCH", 0):
        return None
    d = payload.get("d")
    if not isinstance(d, dict):
        return None
    etype = event_type(payload)
    if etype and etype != "MESSAGE_CREATE":
        return None
    token = d.get("callbackToken")
    text = _first_str(d, TEXT_PATHS)
    if not token or not text:
        return None
    return MessageEvent(
        callback_token=str(token),
        text=text.strip(),
        user_key=_first_str(d, USER_PATHS) or "anonymous",
        room_key=_first_str(d, ROOM_PATHS),
        event_type=etype or "MESSAGE_CREATE",
    )


def redact(payload: Any) -> Any:
    """로그용: 토큰류 값 마스킹."""
    if isinstance(payload, dict):
        return {
            k: ("***" if "token" in k.lower() or k.lower() in ("authorization",) else redact(v))
            for k, v in payload.items()
        }
    if isinstance(payload, list):
        return [redact(v) for v in payload]
    return payload
