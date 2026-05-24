"""
Postgres writer — takes a validated InferenceLogModel and INSERTs it into
the inference_logs table.

Key behaviours
--------------
* ON CONFLICT (id) DO NOTHING  — idempotent; safe on XREADGROUP re-delivery.
* FK guard                      — if conversation_id references a conversation
                                  that does not exist yet, the FK constraint
                                  fires; we catch it and retry with
                                  conversation_id=NULL so the log is never lost.
* Connection pool               — reuses the same lazy ThreadedConnectionPool
                                  pattern as apps/backend/db.py.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2 import pool
from psycopg2.errors import ForeignKeyViolation

from validator import InferenceLogModel

# ── Connection pool ─────────────────────────────────────────────────────────────

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError(
                "DATABASE_URL is not set. "
                "Create apps/ingestion/.env (copy .env.example) and fill in your Postgres URL."
            )
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=database_url,
        )
    return _pool


@contextmanager
def get_conn():
    conn = _get_pool().getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _get_pool().putconn(conn)


# ── INSERT helper ───────────────────────────────────────────────────────────────

_INSERT_SQL = """
INSERT INTO inference_logs (
    id, conversation_id, provider, model, status,
    latency_ms, prompt_tokens, completion_tokens, total_tokens,
    error_code, error_message,
    request_at, response_at,
    input_preview, output_preview,
    pii_redacted, raw_metadata
) VALUES (
    %s, %s, %s, %s, %s,
    %s, %s, %s, %s,
    %s, %s,
    %s, %s,
    %s, %s,
    %s, %s
)
ON CONFLICT (id) DO NOTHING
"""


def _execute_insert(cur, log: InferenceLogModel, conversation_id) -> None:
    cur.execute(
        _INSERT_SQL,
        (
            log.id,
            conversation_id,
            log.provider,
            log.model,
            log.status,
            log.latency_ms,
            log.prompt_tokens,
            log.completion_tokens,
            log.total_tokens,
            log.error_code,
            log.error_message,
            log.request_at,
            log.response_at,
            log.input_preview,
            log.output_preview,
            log.pii_redacted,
            psycopg2.extras.Json(log.raw_metadata),
        ),
    )


def write_log(log: InferenceLogModel) -> None:
    """
    Insert *log* into inference_logs.

    If conversation_id triggers a FK violation (the conversation row has not
    been written to Postgres yet), we retry with conversation_id=NULL so the
    log record is never lost.

    Raises any non-FK exception so the caller (consumer._process) can decide
    whether to XACK or leave the entry in the pending-entries list for retry.
    """
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                _execute_insert(cur, log, log.conversation_id)
    except ForeignKeyViolation:
        # conversation_id references a conversation that doesn't exist yet —
        # store the log without the FK so it is never silently dropped.
        with get_conn() as conn:
            with conn.cursor() as cur:
                _execute_insert(cur, log, None)
