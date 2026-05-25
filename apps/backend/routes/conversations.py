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


@conversations_bp.patch("/<conversation_id>/stop")
def stop_conversation(conversation_id: str):
    """Save a partial assistant response (if any) and mark the conversation cancelled."""
    data = request.get_json(silent=True) or {}
    partial_content = data.get("partial_content", "")

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Persist whatever tokens arrived before the user stopped
            if partial_content:
                cur.execute(
                    """
                    INSERT INTO messages (id, conversation_id, role, content, created_at)
                    VALUES (gen_random_uuid(), %s, 'assistant', %s, NOW())
                    """,
                    (conversation_id, partial_content),
                )

            cur.execute(
                "UPDATE conversations SET status = 'cancelled', updated_at = NOW() "
                "WHERE id = %s RETURNING id",
                (conversation_id,),
            )
            if cur.fetchone() is None:
                return jsonify({"error": "Conversation not found"}), 404

    return jsonify({"id": conversation_id, "status": "cancelled"})


@conversations_bp.patch("/<conversation_id>/resume")
def resume_conversation(conversation_id: str):
    """Reactivate a cancelled conversation."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET status = 'active', updated_at = NOW() "
                "WHERE id = %s RETURNING id",
                (conversation_id,),
            )
            if cur.fetchone() is None:
                return jsonify({"error": "Conversation not found"}), 404

    return jsonify({"id": conversation_id, "status": "active"})


@conversations_bp.get("/metrics")
def list_conversation_metrics():
    """Return all conversations for the session enriched with per-conversation aggregates."""
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "X-Session-ID header is required"}), 400

    from_ts = request.args.get("from")
    to_ts   = request.args.get("to")

    # Default: last 7 days (wider window than summary cards)
    from datetime import datetime, timezone, timedelta
    if not to_ts:
        to_dt = datetime.now(timezone.utc)
    else:
        to_dt = datetime.fromisoformat(to_ts.replace("Z", "+00:00"))

    if not from_ts:
        from_dt = to_dt - timedelta(days=7)
    else:
        from_dt = datetime.fromisoformat(from_ts.replace("Z", "+00:00"))

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
                    COUNT(il.id)                                                         AS request_count,
                    SUM(il.total_tokens)                                                 AS total_tokens,
                    ROUND(AVG(il.latency_ms))                                            AS avg_latency_ms,
                    MAX(il.latency_ms)                                                   AS max_latency_ms,
                    ROUND(
                        100.0 * SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)
                        / NULLIF(COUNT(il.id), 0), 1
                    )                                                                    AS error_rate,
                    MODE() WITHIN GROUP (ORDER BY il.provider)                          AS primary_provider,
                    MODE() WITHIN GROUP (ORDER BY il.model)                             AS primary_model,
                    MIN(il.request_at)                                                   AS first_request_at,
                    MAX(il.response_at)                                                  AS last_response_at
                FROM conversations c
                LEFT JOIN inference_logs il ON il.conversation_id = c.id
                WHERE c.session_id = %s
                  AND c.created_at BETWEEN %s AND %s
                GROUP BY c.id, c.title, c.status, c.created_at, c.updated_at
                ORDER BY c.updated_at DESC
                LIMIT 50
                """,
                (session_id, from_dt, to_dt),
            )
            rows = cur.fetchall()
            cols = [desc[0] for desc in cur.description]

    result = []
    for row in rows:
        item = dict(zip(cols, row))
        for key in ("created_at", "updated_at", "first_request_at", "last_response_at"):
            if item.get(key):
                item[key] = item[key].isoformat()
        # Ensure numeric fields are JSON-serialisable (Decimal → float)
        for key in ("total_tokens", "avg_latency_ms", "max_latency_ms", "error_rate", "request_count"):
            if item.get(key) is not None:
                item[key] = int(item[key]) if key in ("total_tokens", "avg_latency_ms", "max_latency_ms", "request_count") else float(item[key])
        result.append(item)

    return jsonify(result)


@conversations_bp.get("/<conversation_id>/metrics")
def get_conversation_metrics(conversation_id: str):
    """Return turn-by-turn inference logs for a single conversation."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Verify conversation exists
            cur.execute("SELECT id FROM conversations WHERE id = %s", (conversation_id,))
            if cur.fetchone() is None:
                return jsonify({"error": "Conversation not found"}), 404

            cur.execute(
                """
                SELECT
                    il.id,
                    il.provider,
                    il.model,
                    il.status,
                    il.latency_ms,
                    il.prompt_tokens,
                    il.completion_tokens,
                    il.total_tokens,
                    il.error_code,
                    il.input_preview,
                    il.output_preview,
                    il.request_at,
                    il.response_at
                FROM inference_logs il
                WHERE il.conversation_id = %s
                ORDER BY il.request_at ASC
                """,
                (conversation_id,),
            )
            rows = cur.fetchall()
            cols = [desc[0] for desc in cur.description]

    result = []
    for row in rows:
        item = dict(zip(cols, row))
        for key in ("request_at", "response_at"):
            if item.get(key):
                item[key] = item[key].isoformat()
        result.append(item)

    return jsonify(result)


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
