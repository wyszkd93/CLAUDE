import asyncio
import time

from fastapi.testclient import TestClient

from app import agent, kakao, main
from app.events import parse_message, redact


def msg(**d):
    # 2026-10-26 실제 수신 형식
    base = {"id": 902394610299440355, "isChannelChatroom": True, "botGroupKey": "bg2_x",
            "botUserKey": "u1", "content": "안녕", "timestamp": "2026-10-26T03:14:00Z",
            "callbackToken": "cb-1", "type": "MESSAGE_CREATE"}
    base.update(d)
    return {"op": 0, "d": base, "t": "MESSAGE_CREATE"}


def test_parse_message_basic():
    ev = parse_message(msg())
    assert ev and ev.callback_token == "cb-1" and ev.text == "안녕" and ev.user_key == "u1"
    assert ev.room_key == "bg2_x" and ev.event_id == "902394610299440355" and ev.is_channel


def test_parse_ignores_other_events_and_missing_token():
    assert parse_message({"op": "DISPATCH", "t": "ENTRANCE", "d": {"callbackToken": "x"}}) is None
    assert parse_message({"op": "HEARTBEAT"}) is None
    assert parse_message({"op": "DISPATCH", "t": "MESSAGE_CREATE", "d": {"message": {"text": "a"}}}) is None


def test_parse_alternate_text_field():
    ev = parse_message({"op": "DISPATCH", "t": "MESSAGE_CREATE", "d": {"callbackToken": "c", "text": "hi"}})
    assert ev and ev.text == "hi" and ev.user_key == "anonymous"


def test_redact_masks_tokens():
    out = redact(msg())
    assert out["d"]["callbackToken"] == "***" and out["d"]["botUserKey"] == "u1"


def test_chunk_text_limits():
    chunks = kakao.chunk_text("가" * 3500)
    assert len(chunks) == 3 and all(len(c) <= 1000 for c in chunks) and chunks[-1].endswith("…")
    assert kakao.chunk_text("짧음") == ["짧음"]


def test_skill_response_shape():
    r = kakao.build_skill_response("답", ["도움말"])
    assert r["version"] == "2.0"
    assert r["template"]["outputs"] == [{"simpleText": {"text": "답"}}]
    assert r["template"]["quickReplies"][0] == {"label": "도움말", "action": "message", "messageText": "도움말"}


def test_webhook_fast_ack_and_callback(monkeypatch):
    sent = []

    async def fake_answer(user_key, text):
        await asyncio.sleep(0.01)
        return f"echo:{text}"

    async def fake_send(token, skill):
        sent.append((token, skill))
        return True

    monkeypatch.setattr(agent, "answer", fake_answer)
    monkeypatch.setattr(kakao, "send_callback", fake_send)
    main._seen_events.clear()
    c = TestClient(main.app)
    t0 = time.time()
    r = c.post("/webhook", json=msg())
    assert r.status_code == 200 and time.time() - t0 < 1.0
    assert sent and sent[0][0] == "cb-1"
    assert sent[0][1]["template"]["outputs"][0]["simpleText"]["text"] == "echo:안녕"
    # 같은 콜백 토큰 재전송은 무시
    c.post("/webhook", json=msg())
    assert len(sent) == 1


def test_webhook_agent_failure_sends_apology(monkeypatch):
    sent = []

    async def boom(user_key, text):
        raise RuntimeError("x")

    async def fake_send(token, skill):
        sent.append(skill)
        return True

    monkeypatch.setattr(agent, "answer", boom)
    monkeypatch.setattr(kakao, "send_callback", fake_send)
    main._seen_events.clear()
    r = TestClient(main.app).post("/webhook", json=msg(callbackToken="cb-2", id=2))
    assert r.status_code == 200
    assert "문제가 생겼어요" in sent[0]["template"]["outputs"][0]["simpleText"]["text"]


def test_webhook_bad_body():
    r = TestClient(main.app).post("/webhook", content=b"not json")
    assert r.status_code == 200


def test_health():
    assert TestClient(main.app).get("/health").json()["status"] == "ok"


def test_knowledge_skips_readme():
    assert "README" not in agent.load_knowledge()


def test_webhook_secret(monkeypatch):
    sent = []

    async def fake_answer(user_key, text):
        return "ok"

    async def fake_send(token, skill):
        sent.append(token)
        return True

    monkeypatch.setattr(agent, "answer", fake_answer)
    monkeypatch.setattr(kakao, "send_callback", fake_send)
    monkeypatch.setattr(main.config, "WEBHOOK_SECRET", "s3cret")
    main._seen_events.clear()
    c = TestClient(main.app)
    assert c.post("/webhook", json=msg(id=10)).status_code == 401
    assert c.post("/webhook", json=msg(id=11), headers={"X-Webhook-Secret": "wrong"}).status_code == 401
    assert c.post("/webhook", json=msg(id=12), headers={"X-Webhook-Secret": "s3cret"}).status_code == 200
    assert sent == ["cb-1"]
