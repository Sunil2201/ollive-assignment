"""
Asynchronous log transport.

Sends InferenceLog records off the hot path so LLM call latency is
never affected by logging. Strategy (in order):

  1. Redis Streams via XADD to the key "inference_logs"
  2. HTTP POST to INGESTION_URL/ingest  (if Redis fails or is unavailable)
  3. Silent drop with a WARNING log     (if HTTP also fails)

Every dispatch runs in a daemon thread so it can never block or
propagate exceptions into the caller.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .types import InferenceLog

logger = logging.getLogger(__name__)


class LogTransport:
    _STREAM_KEY = "inference_logs"

    def __init__(
        self,
        redis_url: str | None = None,
        ingestion_url: str | None = None,
    ) -> None:
        self._redis_url = redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379")
        self._ingestion_url = ingestion_url or os.environ.get("INGESTION_URL", "http://localhost:5001")
        self._redis_client = None       # lazy-init
        self._redis_available = True    # set False on first connection failure
        self._lock = threading.Lock()

    # ── Redis ──────────────────────────────────────────────────────────────────

    def _get_redis(self):
        """Lazy-initialise the Redis client; returns None if unavailable."""
        if not self._redis_available:
            return None
        with self._lock:
            if self._redis_client is None:
                try:
                    import redis  # type: ignore[import]
                    client = redis.from_url(
                        self._redis_url,
                        socket_connect_timeout=1,
                        socket_timeout=2,
                    )
                    client.ping()   # validate connection on first use
                    self._redis_client = client
                except Exception as exc:
                    logger.warning(
                        "Redis unavailable, will use HTTP fallback: %s", exc
                    )
                    self._redis_available = False
        return self._redis_client

    def _send_redis(self, payload: dict) -> bool:
        """Attempt XADD. Returns True on success, False on any failure."""
        client = self._get_redis()
        if client is None:
            return False
        try:
            # XADD requires all field values to be strings
            str_payload = {
                k: (v if isinstance(v, str) else json.dumps(v, default=str))
                for k, v in payload.items()
                if v is not None
            }
            client.xadd(self._STREAM_KEY, str_payload)
            return True
        except Exception as exc:
            logger.warning("Redis XADD failed, falling back to HTTP: %s", exc)
            return False

    # ── HTTP fallback ──────────────────────────────────────────────────────────

    def _send_http(self, payload: dict) -> None:
        """POST to the ingestion service. Silently drops on failure."""
        url = self._ingestion_url.rstrip("/") + "/ingest"
        body = json.dumps(payload, default=str).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status >= 400:
                    logger.warning(
                        "Ingestion service returned HTTP %s for log %s",
                        resp.status,
                        payload.get("id"),
                    )
        except Exception as exc:
            logger.warning("Ingestion HTTP fallback failed (log dropped): %s", exc)

    # ── Public interface ───────────────────────────────────────────────────────

    def send(self, log: InferenceLog) -> None:
        """
        Dispatch *log* in a daemon thread. Returns immediately.

        Exceptions in the background thread are caught and logged via
        logging.warning — they are never re-raised into the caller.
        """
        payload = log.to_dict()

        def _worker() -> None:
            try:
                if not self._send_redis(payload):
                    self._send_http(payload)
            except Exception as exc:  # belt-and-suspenders catch-all
                logger.warning("LogTransport._worker raised unexpectedly: %s", exc)

        t = threading.Thread(target=_worker, daemon=True, name="llm-sdk-log")
        t.start()
