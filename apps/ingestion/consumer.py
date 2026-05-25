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

STREAM_KEY   = "inference_logs"
GROUP_NAME   = "ingestion-workers"
CONSUMER     = "worker-1"
BATCH_SIZE   = 10
BLOCK_MS     = 2000
DEAD_LETTER  = "dead_letters.jsonl"
RETRY_SLEEP  = 2


_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is None:
        import os
        import redis

        url = os.environ.get("REDIS_URL", "redis://localhost:6379")
        _redis_client = redis.from_url(
            url,
            socket_connect_timeout=2,
            socket_timeout=5,
            decode_responses=False,
        )

    return _redis_client


def _ensure_group(r) -> None:
    try:
        r.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
        logger.info("Created consumer group '%s' on stream '%s'.", GROUP_NAME, STREAM_KEY)
    except ResponseError as exc:
        if "BUSYGROUP" in str(exc):
            pass
        else:
            raise


def _dead_letter(raw_fields: dict, error: Exception) -> None:
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


def _process(r, msg_id: bytes, fields: dict) -> None:
    decoded = {
        (k.decode() if isinstance(k, bytes) else k): (
            v.decode() if isinstance(v, bytes) else v
        )
        for k, v in fields.items()
    }

    try:
        log = InferenceLogModel(**decoded)
    except ValidationError as exc:
        logger.warning(
            "Validation failed for stream entry %s — dead-lettering. Error: %s",
            msg_id,
            exc,
        )
        _dead_letter(fields, exc)
        r.xack(STREAM_KEY, GROUP_NAME, msg_id)
        return

    try:
        write_log(log)
    except Exception as exc:
        logger.error(
            "DB write failed for entry %s (will retry on restart): %s",
            msg_id,
            exc,
        )
        return

    r.xack(STREAM_KEY, GROUP_NAME, msg_id)
    print(
        f"Ingested log — conversation_id={log.conversation_id} latency_ms={log.latency_ms}",
        flush=True,
    )


def run_consumer() -> None:
    global _redis_client

    logger.info("Consumer loop starting (group=%s, consumer=%s).", GROUP_NAME, CONSUMER)

    while True:
        try:
            r = _get_redis()
            _ensure_group(r)

            entries = r.xreadgroup(
                GROUP_NAME,
                CONSUMER,
                {STREAM_KEY: ">"},
                count=BATCH_SIZE,
                block=BLOCK_MS,
            )

            if not entries:
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
            _redis_client = None
            time.sleep(RETRY_SLEEP)
