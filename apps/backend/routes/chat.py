import json
import uuid
import repository as repo

from flask import Blueprint, Response, jsonify, request
from db import get_conn
from llm_sdk import LLMClient
from llm_sdk.client import PROVIDER_MODELS
from llm_sdk.types import ChatOptions
from prompts import RESUME_CONTINUATION

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")
_llm = LLMClient()


@chat_bp.post("/")
def chat():
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "X-Session-ID header is required"}), 400

    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    conversation_id = data.get("conversationId") or str(uuid.uuid4())
    provider = data.get("provider", "")

    if provider not in PROVIDER_MODELS:
        return jsonify({"error": "unsupported provider"}), 400

    title = next(
        (m["content"][:60] for m in messages if m.get("role") == "user"),
        "New conversation",
    )

    with get_conn() as conn:
        with conn.cursor() as cur:
            repo.upsert_conversation(cur, conversation_id, session_id, title)
            last_user_msg = next(
                (m for m in reversed(messages) if m.get("role") == "user"), None
            )

            if last_user_msg:
                repo.insert_message(cur, conversation_id, "user", last_user_msg["content"])

            status = repo.get_conversation_status(cur, conversation_id)
            if status == "cancelled":
                return jsonify({"error": "Conversation is cancelled. Resume it first."}), 400

            db_messages = repo.fetch_messages(cur, conversation_id)

    try:
        result = _llm.chat(
            provider,
            db_messages,
            ChatOptions(conversation_id=conversation_id),
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    store_content   = result["content"]
    display_content = result.get("display_content", result["content"])

    with get_conn() as conn:
        with conn.cursor() as cur:
            assistant_message_id = repo.insert_message(
                cur, conversation_id, "assistant", store_content
            )
            repo.bump_conversation(cur, conversation_id)

    return jsonify(
        {
            "content":        display_content,
            "conversationId": conversation_id,
            "messageId":      assistant_message_id,
        }
    )


@chat_bp.post("/stream")
def chat_stream():
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "X-Session-ID header is required"}), 400

    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    conversation_id = data.get("conversationId") or str(uuid.uuid4())
    provider = data.get("provider", "")
    is_resume = bool(data.get("isResume", False))

    if provider not in PROVIDER_MODELS:
        return jsonify({"error": "unsupported provider"}), 400

    title = next(
        (m["content"][:60] for m in messages if m.get("role") == "user"),
        "New conversation",
    )

    with get_conn() as conn:
        with conn.cursor() as cur:
            repo.upsert_conversation(cur, conversation_id, session_id, title)
            last_user_msg = next(
                (m for m in reversed(messages) if m.get("role") == "user"), None
            )

            if last_user_msg:
                repo.insert_message(cur, conversation_id, "user", last_user_msg["content"])

            status = repo.get_conversation_status(cur, conversation_id)
            if status == "cancelled":
                return jsonify({"error": "Conversation is cancelled. Resume it first."}), 400

            db_messages = repo.fetch_messages(cur, conversation_id)

    if is_resume and db_messages and db_messages[-1]["role"] == "user":
        llm_messages = db_messages[:-1] + [
            {
                "role": "user",
                "content": RESUME_CONTINUATION,
            }
        ]
    else:
        llm_messages = db_messages

    def generate():
        full_content = ""
        compaction_out: list = []

        try:
            for chunk in _llm.stream(
                provider,
                llm_messages,
                ChatOptions(conversation_id=conversation_id),
                compaction_out=compaction_out,
            ):
                full_content += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            store_content = json.dumps(compaction_out[0]) if compaction_out else full_content
            with get_conn() as conn:
                with conn.cursor() as cur:
                    repo.insert_message(cur, conversation_id, "assistant", store_content)
                    repo.bump_conversation(cur, conversation_id)

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )