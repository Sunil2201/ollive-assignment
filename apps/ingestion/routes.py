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
    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    try:
        log = InferenceLogModel(**data)
    except ValidationError as exc:
        logger.warning("HTTP ingest validation error: %s", exc)
        return jsonify({"error": exc.errors()}), 422

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
