import uuid
from datetime import timezone

from utils import rows_as_dicts


def upsert_conversation(cur, id: str, session_id: str, title: str) -> None:
    cur.execute(
        """
        INSERT INTO conversations (id, session_id, title, status, created_at, updated_at)
        VALUES (%s, %s, %s, 'active', NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
        """,
        (id, session_id, title),
    )


def get_conversation_status(cur, conversation_id: str) -> str | None:
    cur.execute(
        "SELECT status FROM conversations WHERE id = %s",
        (conversation_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def bump_conversation(cur, conversation_id: str) -> None:
    cur.execute(
        "UPDATE conversations SET updated_at = NOW() WHERE id = %s",
        (conversation_id,),
    )


def set_conversation_status(cur, conversation_id: str, status: str) -> bool:
    cur.execute(
        "UPDATE conversations SET status = %s, updated_at = NOW() "
        "WHERE id = %s RETURNING id",
        (status, conversation_id),
    )
    return cur.fetchone() is not None


def list_conversations(cur, session_id: str) -> list[dict]:
    cur.execute(
        """
        SELECT
            c.id,
            c.title,
            c.status,
            c.created_at,
            c.updated_at,
            COUNT(m.id) AS message_count,
            (
                SELECT MODE() WITHIN GROUP (ORDER BY il.provider)
                FROM inference_logs il
                WHERE il.conversation_id = c.id
            ) AS primary_provider
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.session_id = %s
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT 50
        """,
        (session_id,),
    )
    return rows_as_dicts(cur)


def get_conversation_by_id(cur, conversation_id: str) -> dict | None:
    cur.execute(
        "SELECT id, title, status, session_id, created_at, updated_at "
        "FROM conversations WHERE id = %s",
        (conversation_id,),
    )
    rows = rows_as_dicts(cur)
    return rows[0] if rows else None


def delete_conversation(cur, conversation_id: str) -> bool:
    cur.execute(
        "DELETE FROM conversations WHERE id = %s RETURNING id",
        (conversation_id,),
    )
    return cur.fetchone() is not None


def insert_message(cur, conversation_id: str, role: str, content: str) -> str:
    message_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES (%s, %s, %s, %s, NOW())
        """,
        (message_id, conversation_id, role, content),
    )
    return message_id


def insert_partial_message(cur, conversation_id: str, content: str) -> None:
    cur.execute(
        """
        INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES (gen_random_uuid(), %s, 'assistant', %s, NOW())
        """,
        (conversation_id, content),
    )


def fetch_messages(cur, conversation_id: str) -> list[dict]:
    cur.execute(
        "SELECT role, content FROM messages "
        "WHERE conversation_id = %s "
        "ORDER BY created_at ASC",
        (conversation_id,),
    )
    return [{"role": row[0], "content": row[1]} for row in cur.fetchall()]


def fetch_messages_full(cur, conversation_id: str) -> list[dict]:
    cur.execute(
        "SELECT id, role, content, created_at "
        "FROM messages WHERE conversation_id = %s "
        "ORDER BY created_at ASC",
        (conversation_id,),
    )
    return rows_as_dicts(cur)


def list_conversation_metrics(cur, session_id: str, from_dt, to_dt) -> list[dict]:
    cur.execute(
        """
        SELECT
            c.id,
            c.title,
            c.status,
            c.created_at,
            c.updated_at,
            COUNT(il.id)                                                        AS request_count,
            SUM(il.total_tokens)                                                AS total_tokens,
            ROUND(AVG(il.latency_ms))                                           AS avg_latency_ms,
            MAX(il.latency_ms)                                                  AS max_latency_ms,
            ROUND(
                100.0 * SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)
                / NULLIF(COUNT(il.id), 0), 1
            )                                                                   AS error_rate,
            MODE() WITHIN GROUP (ORDER BY il.provider)                         AS primary_provider,
            MODE() WITHIN GROUP (ORDER BY il.model)                            AS primary_model,
            MIN(il.request_at)                                                  AS first_request_at,
            MAX(il.response_at)                                                 AS last_response_at
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
    return rows_as_dicts(cur)


def get_inference_logs(cur, conversation_id: str) -> list[dict]:
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
    return rows_as_dicts(cur)


def get_metrics_summary(cur, session_id: str, from_dt, to_dt) -> dict:
    params = {"from": from_dt, "to": to_dt, "session_id": session_id}
    cur.execute(
        """
        SELECT
            COUNT(*)                                                             AS total_requests,
            ROUND(AVG(il.latency_ms))                                           AS avg_latency_ms,
            ROUND(
                100.0 * SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)
                / NULLIF(COUNT(*), 0), 1
            )                                                                   AS error_rate,
            SUM(il.total_tokens)                                                AS total_tokens
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
        "error_rate":     float(card_row.get("error_rate") or 0),
        "total_tokens":   int(card_row.get("total_tokens") or 0),
    }

    cur.execute(
        """
        SELECT
            DATE_TRUNC('hour', il.created_at)                                   AS hour,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY il.latency_ms)        AS p50,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY il.latency_ms)        AS p95,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY il.latency_ms)        AS p99
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
            "hour": (r["hour"].astimezone(timezone.utc) if r["hour"].tzinfo else r["hour"]).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "p50":  int(r["p50"] or 0),
            "p95":  int(r["p95"] or 0),
            "p99":  int(r["p99"] or 0),
        }
        for r in (dict(zip(cols, row)) for row in cur.fetchall())
    ]

    cur.execute(
        """
        SELECT
            DATE_TRUNC('hour', il.created_at) AS hour,
            COUNT(*)                           AS count
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
            "hour": (r["hour"].astimezone(timezone.utc) if r["hour"].tzinfo else r["hour"]).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "count": int(r["count"] or 0)
        }
        for r in (dict(zip(cols, row)) for row in cur.fetchall())
    ]

    cur.execute(
        """
        SELECT
            il.provider,
            COUNT(*)                                                             AS requests,
            SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)              AS errors,
            ROUND(
                100.0 * SUM(CASE WHEN il.status = 'error' THEN 1 ELSE 0 END)
                / NULLIF(COUNT(*), 0), 1
            )                                                                   AS error_rate
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
            "provider":   r["provider"],
            "requests":   int(r["requests"] or 0),
            "errors":     int(r["errors"] or 0),
            "error_rate": float(r["error_rate"] or 0),
        }
        for r in (dict(zip(cols, row)) for row in cur.fetchall())
    ]

    return {
        "cards":              cards,
        "latency_over_time":  latency_over_time,
        "throughput":         throughput,
        "errors_by_provider": errors_by_provider,
    }
