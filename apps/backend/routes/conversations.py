import repository as repo

from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, request
from db import get_conn
from utils import iso

conversations_bp = Blueprint("conversations", __name__, url_prefix="/api/conversations")


@conversations_bp.get("/")
def list_conversations():
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "X-Session-ID header is required"}), 400

    with get_conn() as conn:
        with conn.cursor() as cur:
            conversations = repo.list_conversations(cur, session_id)

    for conv in conversations:
        conv["created_at"] = iso(conv.get("created_at"))
        conv["updated_at"] = iso(conv.get("updated_at"))

    return jsonify(conversations)


@conversations_bp.get("/<conversation_id>")
def get_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            conversation = repo.get_conversation_by_id(cur, conversation_id)
            if conversation is None:
                return jsonify({"error": "Conversation not found"}), 404

            messages = repo.fetch_messages_full(cur, conversation_id)

    for msg in messages:
        msg["created_at"] = iso(msg.get("created_at"))

    conversation["created_at"] = iso(conversation.get("created_at"))
    conversation["updated_at"] = iso(conversation.get("updated_at"))
    conversation["messages"] = messages

    return jsonify(conversation)


@conversations_bp.patch("/<conversation_id>/cancel")
def cancel_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            found = repo.set_conversation_status(cur, conversation_id, "cancelled")
    if not found:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify({"id": conversation_id, "status": "cancelled"})


@conversations_bp.patch("/<conversation_id>/stop")
def stop_conversation(conversation_id: str):
    data = request.get_json(silent=True) or {}
    partial_content = data.get("partial_content", "")

    with get_conn() as conn:
        with conn.cursor() as cur:
            if partial_content:
                repo.insert_partial_message(cur, conversation_id, partial_content)

            found = repo.set_conversation_status(cur, conversation_id, "cancelled")
    if not found:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify({"id": conversation_id, "status": "cancelled"})


@conversations_bp.patch("/<conversation_id>/resume")
def resume_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            found = repo.set_conversation_status(cur, conversation_id, "active")
    if not found:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify({"id": conversation_id, "status": "active"})


@conversations_bp.get("/metrics")
def list_conversation_metrics():
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "X-Session-ID header is required"}), 400

    from_ts = request.args.get("from")
    to_ts   = request.args.get("to")

    to_dt   = datetime.fromisoformat(to_ts.replace("Z", "+00:00"))   if to_ts   else datetime.now(timezone.utc)
    from_dt = datetime.fromisoformat(from_ts.replace("Z", "+00:00")) if from_ts else to_dt - timedelta(days=7)

    with get_conn() as conn:
        with conn.cursor() as cur:
            rows = repo.list_conversation_metrics(cur, session_id, from_dt, to_dt)

    ts_fields  = ("created_at", "updated_at", "first_request_at", "last_response_at")
    int_fields = ("total_tokens", "avg_latency_ms", "max_latency_ms", "request_count")

    result = []
    for item in rows:
        for key in ts_fields:
            item[key] = iso(item.get(key))
        for key in int_fields:
            if item.get(key) is not None:
                item[key] = int(item[key])
        if item.get("error_rate") is not None:
            item["error_rate"] = float(item["error_rate"])
        result.append(item)

    return jsonify(result)


@conversations_bp.get("/<conversation_id>/metrics")
def get_conversation_metrics(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if repo.get_conversation_by_id(cur, conversation_id) is None:
                return jsonify({"error": "Conversation not found"}), 404

            logs = repo.get_inference_logs(cur, conversation_id)

    for item in logs:
        item["request_at"]  = iso(item.get("request_at"))
        item["response_at"] = iso(item.get("response_at"))

    return jsonify(logs)


@conversations_bp.delete("/<conversation_id>")
def delete_conversation(conversation_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            found = repo.delete_conversation(cur, conversation_id)
    if not found:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify({"deleted": conversation_id})
