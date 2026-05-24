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
    to_str = request.args.get("to")

    now = datetime.now(timezone.utc)
    from_dt = datetime.fromisoformat(from_str) if from_str else now - timedelta(hours=24)
    to_dt = datetime.fromisoformat(to_str) if to_str else now
    params = {"from": from_dt, "to": to_dt, "session_id": session_id}

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:

                # ── Query 1: metric cards ─────────────────────────────────
                cur.execute(
                    """
                    SELECT
                        COUNT(*) AS total_requests,
                        ROUND(AVG(il.latency_ms)) AS avg_latency_ms,
                        ROUND(
                            100.0 * SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)
                            / NULLIF(COUNT(*), 0), 1
                        ) AS error_rate,
                        SUM(il.total_tokens) AS total_tokens
                    FROM inference_logs il
                    INNER JOIN conversations c ON il.conversation_id = c.id
                    WHERE il.created_at BETWEEN %(from)s AND %(to)s
                      AND c.session_id = %(session_id)s
                    """,
                    params,
                )
                row = cur.fetchone()
                cols = [d[0] for d in cur.description]
                card_row = dict(zip(cols, row)) if row else {}
                cards = {
                    "total_requests": int(card_row.get("total_requests") or 0),
                    "avg_latency_ms": int(card_row.get("avg_latency_ms") or 0),
                    "error_rate": float(card_row.get("error_rate") or 0),
                    "total_tokens": int(card_row.get("total_tokens") or 0),
                }

                # ── Query 2: latency over time ────────────────────────────
                cur.execute(
                    """
                    SELECT
                        DATE_TRUNC('hour', il.created_at) AS hour,
                        PERCENTILE_CONT(0.50) WITHIN GROUP
                            (ORDER BY il.latency_ms) AS p50,
                        PERCENTILE_CONT(0.95) WITHIN GROUP
                            (ORDER BY il.latency_ms) AS p95,
                        PERCENTILE_CONT(0.99) WITHIN GROUP
                            (ORDER BY il.latency_ms) AS p99
                    FROM inference_logs il
                    INNER JOIN conversations c ON il.conversation_id = c.id
                    WHERE il.created_at BETWEEN %(from)s AND %(to)s
                      AND il.latency_ms IS NOT NULL
                      AND c.session_id = %(session_id)s
                    GROUP BY DATE_TRUNC('hour', il.created_at)
                    ORDER BY hour ASC
                    """,
                    params,
                )
                cols = [d[0] for d in cur.description]
                latency_over_time = [
                    {
                        "hour": r["hour"].strftime("%H:%M"),
                        "p50": int(r["p50"] or 0),
                        "p95": int(r["p95"] or 0),
                        "p99": int(r["p99"] or 0),
                    }
                    for r in (dict(zip(cols, row)) for row in cur.fetchall())
                ]

                # ── Query 3: throughput ───────────────────────────────────
                cur.execute(
                    """
                    SELECT
                        DATE_TRUNC('hour', il.created_at) AS hour,
                        COUNT(*) AS count
                    FROM inference_logs il
                    INNER JOIN conversations c ON il.conversation_id = c.id
                    WHERE il.created_at BETWEEN %(from)s AND %(to)s
                      AND c.session_id = %(session_id)s
                    GROUP BY DATE_TRUNC('hour', il.created_at)
                    ORDER BY hour ASC
                    """,
                    params,
                )
                cols = [d[0] for d in cur.description]
                throughput = [
                    {
                        "hour": r["hour"].strftime("%H:%M"),
                        "count": int(r["count"] or 0),
                    }
                    for r in (dict(zip(cols, row)) for row in cur.fetchall())
                ]

                # ── Query 4: errors by provider ───────────────────────────
                cur.execute(
                    """
                    SELECT
                        il.provider,
                        COUNT(*) AS requests,
                        SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END) AS errors,
                        ROUND(
                            100.0 * SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)
                            / NULLIF(COUNT(*), 0), 1
                        ) AS error_rate
                    FROM inference_logs il
                    INNER JOIN conversations c ON il.conversation_id = c.id
                    WHERE il.created_at BETWEEN %(from)s AND %(to)s
                      AND c.session_id = %(session_id)s
                    GROUP BY il.provider
                    ORDER BY requests DESC
                    """,
                    params,
                )
                cols = [d[0] for d in cur.description]
                errors_by_provider = [
                    {
                        "provider": r["provider"],
                        "requests": int(r["requests"] or 0),
                        "errors": int(r["errors"] or 0),
                        "error_rate": float(r["error_rate"] or 0),
                    }
                    for r in (dict(zip(cols, row)) for row in cur.fetchall())
                ]

    except Exception:
        return jsonify({"error": "failed to fetch metrics"}), 500

    return jsonify(
        {
            "cards": cards,
            "latency_over_time": latency_over_time,
            "throughput": throughput,
            "errors_by_provider": errors_by_provider,
        }
    )
