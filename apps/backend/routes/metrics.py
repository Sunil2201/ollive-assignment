import repository as repo

from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, request
from db import get_conn

metrics_bp = Blueprint("metrics", __name__, url_prefix="/api/metrics")


@metrics_bp.route("/summary")
def get_summary():
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        return jsonify({"error": "missing X-Session-ID header"}), 400

    from_str = request.args.get("from")
    to_str   = request.args.get("to")

    now     = datetime.now(timezone.utc)
    from_dt = datetime.fromisoformat(from_str) if from_str else now - timedelta(hours=24)
    to_dt   = datetime.fromisoformat(to_str)   if to_str   else now

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                summary = repo.get_metrics_summary(cur, session_id, from_dt, to_dt)
    except Exception:
        return jsonify({"error": "failed to fetch metrics"}), 500

    return jsonify(summary)