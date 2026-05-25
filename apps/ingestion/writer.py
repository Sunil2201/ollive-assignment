from __future__ import annotations

import psycopg2.extras
from psycopg2.errors import ForeignKeyViolation

from db import get_conn
from validator import InferenceLogModel


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
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                _execute_insert(cur, log, log.conversation_id)
    except ForeignKeyViolation:
        with get_conn() as conn:
            with conn.cursor() as cur:
                _execute_insert(cur, log, None)
