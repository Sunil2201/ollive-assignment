"""
Redis Streams consumer.

Consumer group : ingestion-workers
Consumer name  : worker-1
Stream key     : inference_logs

XACK policy
-----------
  * Successful DB write  → XACK immediately after write_log() returns.
  * Validation failure   → dead-letter to dead_letters.jsonl, then XACK
                           (bad records must never block the queue).
  * DB failure           → skip XACK; entry stays in the PEL and is
                           re-delivered to the next consumer on restart.

Resilience
----------
  The outer while-loop catches every exception and sleeps briefly before
  retrying, so the service starts cleanly even when Redis is temporarily
  unavailable.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

from pydantic import ValidationError
from redis.exceptions import ResponseError

from validator import InferenceLogModel
from writer import write_log

logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────────

STREAM_KEY   = "inference_logs"
GROUP_NAME   = "ingestion-workers"
CONSUMER     = "worker-1"
BATCH_SIZE   = 10
BLOCK_MS     = 2000
DEAD_LETTER  = "dead_letters.jsonl"
RETRY_SLEEP  = 2   # seconds to back-off when Redis is unavailable

# ── Redis client (lazy) ─────────────────────────────────────────────────────────

_redis_client = None


def _get_redis():
    """
    Return a lazily-initialised Redis client.
    Raises on connection failure — the caller's try/except handles it.
    """
    global _redis_client
    if _redis_client is None:
        import os
        import redis

        url = os.environ.get("REDIS_URL", "redis://localhost:6379")
        _redis_client = redis.from_url(
            url,
            socket_connect_timeout=2,
            socket_timeout=5,
            decode_responses=False,   # we decode manually; bytes are safer
        )
    return _redis_client


# ── Consumer group bootstrap ────────────────────────────────────────────────────

def _ensure_group(r) -> None:
    """Create the consumer group (with MKSTREAM) if it does not exist yet."""
    try:
        r.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
        logger.info("Created consumer group '%s' on stream '%s'.", GROUP_NAME, STREAM_KEY)
    except ResponseError as exc:
        if "BUSYGROUP" in str(exc):
            # Group already exists — this is the normal case after a restart.
            pass
        else:
            raise


# ── Dead-letter ─────────────────────────────────────────────────────────────────

def _dead_letter(raw_fields: dict, error: Exception) -> None:
    """Append an unprocessable entry to dead_letters.jsonl."""
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "error": str(error),
        "fields": {
            (k.decode() if isinstance(k, bytes) else k): (
                v.decode() if isinstance(v, bytes) else v
            )
            for k, v in raw_fields.items()
        },
    }
    try:
        with open(DEAD_LETTER, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError as write_err:
        logger.warning("Could not write dead letter: %s", write_err)


# ── Per-message processing ──────────────────────────────────────────────────────

def _process(r, msg_id: bytes, fields: dict) -> None:
    """
    Deserialise → validate → write → XACK.

    XACK happens:
      * after a successful DB write (happy path)
      * after a validation failure (dead-lettered; must not block the queue)

    XACK is intentionally skipped on DB errors so the entry stays in the
    pending-entries list and is re-delivered on the next consumer startup.
    """
    # Decode bytes keys/values from Redis
    decoded = {
        (k.decode() if isinstance(k, bytes) else k): (
            v.decode() if isinstance(v, bytes) else v
        )
        for k, v in fields.items()
    }

    # ── Validate ────────────────────────────────────────────────────────────────
    try:
        log = InferenceLogModel(**decoded)
    except ValidationError as exc:
        logger.warning(
            "Validation failed for stream entry %s — dead-lettering. Error: %s",
            msg_id,
            exc,
        )
        _dead_letter(fields, exc)
        r.xack(STREAM_KEY, GROUP_NAME, msg_id)   # XACK: bad record, don't retry
        return

    # ── Write to Postgres ────────────────────────────────────────────────────────
    try:
        write_log(log)
    except Exception as exc:
        # Leave the entry in the PEL — it will be re-delivered on restart.
        logger.error(
            "DB write failed for entry %s (will retry on restart): %s",
            msg_id,
            exc,
        )
        return   # skip XACK intentionally

    # ── Acknowledge only after confirmed write ───────────────────────────────────
    r.xack(STREAM_KEY, GROUP_NAME, msg_id)
    print(
        f"Ingested log — conversation_id={log.conversation_id} latency_ms={log.latency_ms}",
        flush=True,
    )


# ── Main consumer loop ──────────────────────────────────────────────────────────

def run_consumer() -> None:
    """
    Blocking consumer loop.  Designed to be called from a daemon thread
    in app.py — it never returns under normal operation.

    The outer try/except ensures the loop survives transient Redis
    outages: it resets the cached client and backs off before retrying.
    """
    global _redis_client

    logger.info("Consumer loop starting (group=%s, consumer=%s).", GROUP_NAME, CONSUMER)

    while True:
        try:
            r = _get_redis()
            _ensure_group(r)

            entries = r.xreadgroup(
                GROUP_NAME,
                CONSUMER,
                {STREAM_KEY: ">"},   # ">" means only new, undelivered entries
                count=BATCH_SIZE,
                block=BLOCK_MS,
            )

            if not entries:
                # BLOCK timeout — no new messages; loop immediately.
                continue

            for _stream, messages in entries:
                for msg_id, fields in messages:
                    _process(r, msg_id, fields)

        except KeyboardInterrupt:
            logger.info("Consumer loop stopped by KeyboardInterrupt.")
            break
        except Exception as exc:
            logger.warning(
                "Consumer loop error (%s) — retrying in %ds.",
                exc,
                RETRY_SLEEP,
            )
            # Reset the cached client so we attempt a fresh connection next time.
            _redis_client = None
            time.sleep(RETRY_SLEEP)
