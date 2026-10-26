import os

KAKAO_BOT_TOKEN = os.environ.get("KAKAO_BOT_TOKEN", "")
KAKAO_CALLBACK_URL = os.environ.get("KAKAO_CALLBACK_URL", "https://kapi.kakao.com/v1/bot/callback")

CLAUDE_MODEL = os.environ.get("BOT_MODEL", "claude-opus-5-5")
# 채팅 응답 속도를 위해 기본값은 low. 품질이 부족하면 medium으로 올린다.
CLAUDE_EFFORT = os.environ.get("BOT_EFFORT", "low")
CLAUDE_TIMEOUT_SEC = float(os.environ.get("BOT_TIMEOUT_SEC", "90"))

# 대화 기억: 사용자별 최근 N개 메시지, TTL(초)
HISTORY_MAX_MESSAGES = int(os.environ.get("HISTORY_MAX_MESSAGES", "12")) // 2 * 2  # user/assistant 쌍 단위
HISTORY_TTL_SEC = int(os.environ.get("HISTORY_TTL_SEC", "3600"))

KNOWLEDGE_DIR = os.environ.get("KNOWLEDGE_DIR", os.path.join(os.path.dirname(__file__), "..", "knowledge"))
KNOWLEDGE_MAX_CHARS = int(os.environ.get("KNOWLEDGE_MAX_CHARS", "200000"))

LOG_RAW_EVENTS = os.environ.get("LOG_RAW_EVENTS", "1") == "1"
