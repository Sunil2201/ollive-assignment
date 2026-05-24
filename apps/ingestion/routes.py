"""
Flask Blueprint — HTTP fallback ingestion endpoint.

The SDK's LogTransport falls back to POST /ingest when Redis is unavailable.
This blueprint runs the same validate → write pipeline as the stream consumer
and returns a structured JSON response.

Route: POST /ingest
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from validator import InferenceLogModel
from writer import write_log

logger = logging.getLogger(__name__)

ingest_bp = Blueprint("ingest", __name__)


@ingest_bp.route("/ingest", methods=["POST"])
def ingest():
    """
    Accept an InferenceLog payload and write it to Postgres.

    Returns
    -------
    200  {"ok": true}
    422  {"error": "<validation details>"}    — bad payload; never retry
    500  {"error": "<db error>"}              — transient; caller may retry
    """
    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    # ── Validate ─────────────────────────────────────────────────────────────────
    try:
        log = InferenceLogModel(**data)
    except ValidationError as exc:
        logger.warning("HTTP ingest validation error: %s", exc)
        return jsonify({"error": exc.errors()}), 422

    # ── Write ─────────────────────────────────────────────────────────────────────
    try:
        write_log(log)
    except Exception as exc:
        logger.error("HTTP ingest DB write error: %s", exc)
        return jsonify({"error": str(exc)}), 500

    print(
        f"Ingested log — conversation_id={log.conversation_id} latency_ms={log.latency_ms}",
        flush=True,
    )
    return jsonify({"ok": True}), 200
