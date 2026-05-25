import json
import os
import uuid

from flask import Blueprint, Response, jsonify, request

from db import get_conn
from llm_sdk import LLMClient
from llm_sdk.client import PROVIDER_MODELS
from llm_sdk.types import ChatOptions

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")

# Module-level singleton — one LLMClient reused across requests
_llm = LLMClient()


def _fetch_messages(cur, conversation_id: str) -> list[dict]:
    """Return all messages for *conversation_id* ordered chronologically."""
    cur.execute(
        "SELECT role, content FROM messages "
        "WHERE conversation_id = %s "
        "ORDER BY created_at ASC",
        (conversation_id,),
    )
    return [{"role": row[0], "content": row[1]} for row in cur.fetchall()]


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

    # Derive title from first user message, truncated to 60 chars
    title = next(
        (m["content"][:60] for m in messages if m.get("role") == "user"),
        "New conversation",
    )

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Upsert the conversation row
            cur.execute(
                """
                INSERT INTO conversations (id, session_id, title, status, created_at, updated_at)
                VALUES (%s, %s, %s, 'active', NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
                """,
                (conversation_id, session_id, title),
            )

            # Persist the last user message
            last_user_msg = next(
                (m for m in reversed(messages) if m.get("role") == "user"), None
            )
            if last_user_msg:
                user_message_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO messages (id, conversation_id, role, content, created_at)
                    VALUES (%s, %s, 'user', %s, NOW())
                    """,
                    (user_message_id, conversation_id, last_user_msg["content"]),
                )

            # Guard: reject sends to cancelled conversations
            cur.execute(
                "SELECT status FROM conversations WHERE id = %s",
                (conversation_id,),
            )
            status_row = cur.fetchone()
            if status_row and status_row[0] == "cancelled":
                return jsonify({"error": "Conversation is cancelled. Resume it first."}), 400

            # Rebuild the full conversation history from the database
            db_messages = _fetch_messages(cur, conversation_id)

    # Call the provider via SDK (context trimming happens inside LLMClient)
    try:
        result = _llm.chat(
            provider,
            db_messages,
            ChatOptions(conversation_id=conversation_id),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # When Anthropic compaction occurred, result["content"] is a JSON array
    # (for DB storage / future context replay) while result["display_content"]
    # is the plain text shown to the user.  For all other cases both are the
    # same plain text string.
    store_content   = result["content"]
    display_content = result.get("display_content", result["content"])

    # Persist the assistant reply
    assistant_message_id = str(uuid.uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO messages (id, conversation_id, role, content, created_at)
                VALUES (%s, %s, 'assistant', %s, NOW())
                """,
                (assistant_message_id, conversation_id, store_content),
            )
            # Bump updated_at on the conversation
            cur.execute(
                "UPDATE conversations SET updated_at = NOW() WHERE id = %s",
                (conversation_id,),
            )

    return jsonify(
        {
            "content": display_content,
            "conversationId": conversation_id,
            "messageId": assistant_message_id,
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

    # Derive title from first user message, truncated to 60 chars
    title = next(
        (m["content"][:60] for m in messages if m.get("role") == "user"),
        "New conversation",
    )

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Upsert the conversation row
            cur.execute(
                """
                INSERT INTO conversations (id, session_id, title, status, created_at, updated_at)
                VALUES (%s, %s, %s, 'active', NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
                """,
                (conversation_id, session_id, title),
            )

            # Persist the last user message
            last_user_msg = next(
                (m for m in reversed(messages) if m.get("role") == "user"), None
            )
            if last_user_msg:
                user_message_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO messages (id, conversation_id, role, content, created_at)
                    VALUES (%s, %s, 'user', %s, NOW())
                    """,
                    (user_message_id, conversation_id, last_user_msg["content"]),
                )

            # Guard: reject sends to cancelled conversations
            cur.execute(
                "SELECT status FROM conversations WHERE id = %s",
                (conversation_id,),
            )
            status_row = cur.fetchone()
            if status_row and status_row[0] == "cancelled":
                return jsonify({"error": "Conversation is cancelled. Resume it first."}), 400

            # Rebuild the full conversation history from the database
            db_messages = _fetch_messages(cur, conversation_id)

    # For resume: replace the literal "resume" user message with a precise continuation
    # prompt so the LLM picks up from the exact cut-off point without repeating itself.
    # db_messages ends with: [..., {assistant: partial}, {user: "resume"}]
    if is_resume and db_messages and db_messages[-1]["role"] == "user":
        llm_messages = db_messages[:-1] + [
            {
                "role": "user",
                "content": (
                    "Please continue your previous response from exactly where you stopped. "
                    "Do not repeat anything you already said — start directly with the next word or sentence."
                ),
            }
        ]
    else:
        llm_messages = db_messages

    def generate():
        full_content = ""
        # compaction_out is populated by anthropic_stream when a compaction
        # block is emitted.  It holds the full structured content list
        # (compaction block + text blocks) that must be stored in the DB so
        # future requests can replay the compaction block to the Anthropic API.
        compaction_out: list = []

        try:
            # _llm.stream() handles: trim_context, PII preview, timing, log dispatch
            for chunk in _llm.stream(
                provider,
                llm_messages,
                ChatOptions(conversation_id=conversation_id),
                compaction_out=compaction_out,
            ):
                full_content += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            # When compaction occurred, persist the JSON-serialised structured
            # content so _prepare_anthropic_messages() can reconstruct it on
            # the next request.  Otherwise store the plain text as usual.
            if compaction_out:
                store_content = json.dumps(compaction_out[0])
            else:
                store_content = full_content

            # Save the full assistant reply
            assistant_message_id = str(uuid.uuid4())
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO messages (id, conversation_id, role, content, created_at)
                        VALUES (%s, %s, 'assistant', %s, NOW())
                        """,
                        (assistant_message_id, conversation_id, store_content),
                    )
                    cur.execute(
                        "UPDATE conversations SET updated_at = NOW() WHERE id = %s",
                        (conversation_id,),
                    )

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
