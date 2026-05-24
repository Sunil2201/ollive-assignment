"""
Pydantic model that mirrors the InferenceLog dataclass from the SDK
(packages/sdk/llm_sdk/types.py) and the inference_logs Postgres table.

Two transport paths feed this validator:

  Redis Streams  — transport.py XADD encodes all values with json.dumps(),
                   so booleans arrive as "true"/"false" and dicts as JSON
                   strings.  None values are omitted entirely, so Optional
                   fields just fall back to their defaults.

  HTTP fallback  — proper JSON; Pydantic handles it with no extra coercion.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, field_validator


class InferenceLogModel(BaseModel):
    # ── Identity ────────────────────────────────────────────────────────────────
    id: str
    conversation_id: Optional[str] = None

    # ── Provider info ───────────────────────────────────────────────────────────
    provider: str
    model: str
    status: str = "success"

    # ── Metrics ─────────────────────────────────────────────────────────────────
    latency_ms: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None

    # ── Error info ──────────────────────────────────────────────────────────────
    error_code: Optional[str] = None
    error_message: Optional[str] = None

    # ── Timestamps ──────────────────────────────────────────────────────────────
    request_at: Optional[datetime] = None
    response_at: Optional[datetime] = None

    # ── Content previews ────────────────────────────────────────────────────────
    input_preview: Optional[str] = None
    output_preview: Optional[str] = None

    # ── Flags / extra ───────────────────────────────────────────────────────────
    pii_redacted: bool = False
    raw_metadata: dict[str, Any] = {}

    # ── Validators for the Redis string-encoding path ───────────────────────────

    @field_validator("pii_redacted", mode="before")
    @classmethod
    def _coerce_bool(cls, v: Any) -> Any:
        """
        Redis transport encodes booleans via json.dumps():
          True  → "true"
          False → "false"
        Pydantic's lax mode does not coerce these strings to bool,
        so we do it explicitly here.
        """
        if isinstance(v, str):
            if v.lower() == "true":
                return True
            if v.lower() == "false":
                return False
        return v

    @field_validator("raw_metadata", mode="before")
    @classmethod
    def _coerce_dict(cls, v: Any) -> Any:
        """
        Redis transport encodes dicts via json.dumps():
          {}                → '"{}"'
          {"key": "val"}   → '"{\\"key\\": \\"val\\"}"'
        Parse JSON string back to dict; fall back to empty dict on failure.
        """
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, dict) else {}
            except (json.JSONDecodeError, ValueError):
                return {}
        return v

    @field_validator(
        "conversation_id",
        "error_code",
        "error_message",
        "input_preview",
        "output_preview",
        mode="before",
    )
    @classmethod
    def _empty_str_to_none(cls, v: Any) -> Any:
        """
        Normalise empty strings to None for optional string fields.
        Some transports may send an empty string instead of omitting the key.
        """
        if v == "":
            return None
        return v
