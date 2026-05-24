from flask import Blueprint, jsonify, request

from db import get_conn

conversations_bp = Blueprint("conversations", __name__, url_prefix="/api/conversations")


@conversations_bp.get("/")
def list_conversations():
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "X-Session-ID header is required"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.id,
                    c.title,
                    c.status,
                    c.created_at,
                    c.updated_at,
                    COUNT(m.id) AS message_count
                FROM conversations c
                LEFT JOIN messages m ON m.conversation_id = c.id
                WHERE c.session_id = %s
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT 50
                """,
                (session_id,),
            )
            rows = cur.fetchall()
            cols = [desc[0] for desc in cur.description]

    conversations = [dict(zip(cols, row)) for row in rows]
    # Serialize datetime objects
    for conv in conversations:
        for key in ("created_at", "updated_at"):
            if conv.get(key):
                conv[key] = conv[key].isoformat()

    return jsonify(conversations)


@conversations_bp.get("/<conversation_id>")
def get_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, status, session_id, created_at, updated_at "
                "FROM conversations WHERE id = %s",
                (conversation_id,),
            )
            row = cur.fetchone()
            if row is None:
                return jsonify({"error": "Conversation not found"}), 404

            cols = [desc[0] for desc in cur.description]
            conversation = dict(zip(cols, row))

            cur.execute(
                "SELECT id, role, content, created_at "
                "FROM messages WHERE conversation_id = %s "
                "ORDER BY created_at ASC",
                (conversation_id,),
            )
            msg_rows = cur.fetchall()
            msg_cols = [desc[0] for desc in cur.description]

    messages = [dict(zip(msg_cols, r)) for r in msg_rows]
    for msg in messages:
        if msg.get("created_at"):
            msg["created_at"] = msg["created_at"].isoformat()

    for key in ("created_at", "updated_at"):
        if conversation.get(key):
            conversation[key] = conversation[key].isoformat()

    conversation["messages"] = messages
    return jsonify(conversation)


@conversations_bp.patch("/<conversation_id>/cancel")
def cancel_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET status = 'cancelled', updated_at = NOW() "
                "WHERE id = %s RETURNING id",
                (conversation_id,),
            )
            if cur.fetchone() is None:
                return jsonify({"error": "Conversation not found"}), 404

    return jsonify({"id": conversation_id, "status": "cancelled"})


@conversations_bp.delete("/<conversation_id>")
def delete_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM conversations WHERE id = %s RETURNING id",
                (conversation_id,),
            )
            if cur.fetchone() is None:
                return jsonify({"error": "Conversation not found"}), 404

    return jsonify({"deleted": conversation_id})
