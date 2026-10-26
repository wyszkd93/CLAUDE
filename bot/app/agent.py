"""Claude 호출과 사용자별 대화 기억."""
import logging
import os
import time
from collections import defaultdict

import anthropic

from . import config

log = logging.getLogger("agent")

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "system.md")

_client: anthropic.AsyncAnthropic | None = None
_history: dict[str, list[dict]] = defaultdict(list)
_last_seen: dict[str, float] = {}


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(timeout=config.CLAUDE_TIMEOUT_SEC, max_retries=1)
    return _client


def load_knowledge() -> str:
    """knowledge/ 폴더의 텍스트 파일(.md .csv .txt .json)을 이름순으로 이어 붙인다."""
    parts, total = [], 0
    d = config.KNOWLEDGE_DIR
    if not os.path.isdir(d):
        return ""
    for name in sorted(os.listdir(d)):
        if not name.endswith((".md", ".csv", ".txt", ".json")) or name.startswith((".", "README")):
            continue
        with open(os.path.join(d, name), encoding="utf-8-sig") as f:
            body = f.read()
        block = f'<document name="{name}">\n{body}\n</document>'
        if total + len(block) > config.KNOWLEDGE_MAX_CHARS:
            log.warning("knowledge limit reached; skipped %s", name)
            continue
        parts.append(block)
        total += len(block)
    return "\n\n".join(parts)


def build_system() -> list[dict]:
    with open(PROMPT_PATH, encoding="utf-8") as f:
        prompt = f.read()
    knowledge = load_knowledge()
    text = prompt if not knowledge else f"{prompt}\n\n<knowledge>\n{knowledge}\n</knowledge>"
    # 고정 프롬프트+지식은 캐시해서 비용/지연을 줄인다.
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


SYSTEM = build_system()


def reload_system() -> None:
    global SYSTEM
    SYSTEM = build_system()


def _get_history(user_key: str) -> list[dict]:
    now = time.time()
    if now - _last_seen.get(user_key, now) > config.HISTORY_TTL_SEC:
        _history.pop(user_key, None)
    _last_seen[user_key] = now
    return _history[user_key]


def reset_history(user_key: str) -> None:
    _history.pop(user_key, None)


async def answer(user_key: str, text: str) -> str:
    history = _get_history(user_key)
    messages = history + [{"role": "user", "content": text}]
    resp = await client().beta.messages.create(
        model=config.CLAUDE_MODEL,
        max_tokens=4000,
        system=SYSTEM,
        messages=messages,
        output_config={"effort": config.CLAUDE_EFFORT},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if resp.stop_reason == "refusal":
        reply = "죄송해요, 그 요청은 도와드리기 어려워요. 다른 방식으로 질문해 주시겠어요?"
    else:
        reply = "".join(b.text for b in resp.content if b.type == "text").strip()
        if resp.stop_reason == "max_tokens":
            reply += "\n(답변이 길어 일부가 생략되었어요.)"
    if not reply:
        reply = "죄송해요, 답변을 만들지 못했어요. 다시 한번 말씀해 주세요."
    history.extend([{"role": "user", "content": text}, {"role": "assistant", "content": reply}])
    del history[: max(0, len(history) - config.HISTORY_MAX_MESSAGES)]
    log.info("usage in=%s out=%s cache_read=%s", resp.usage.input_tokens, resp.usage.output_tokens,
             getattr(resp.usage, "cache_read_input_tokens", None))
    return reply
