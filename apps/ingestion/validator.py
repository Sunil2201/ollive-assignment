from __future__ import annotations

import json

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, field_validator


class InferenceLogModel(BaseModel):
    id: str
    conversation_id: Optional[str] = None

    provider: str
    model: str
    status: str = "success"

    latency_ms: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None

    error_code: Optional[str] = None
    error_message: Optional[str] = None

    request_at: Optional[datetime] = None
    response_at: Optional[datetime] = None

    input_preview: Optional[str] = None
    output_preview: Optional[str] = None

    pii_redacted: bool = False
    raw_metadata: dict[str, Any] = {}

    @field_validator("pii_redacted", mode="before")
    @classmethod
    def _coerce_bool(cls, v: Any) -> Any:
        if isinstance(v, str):
            if v.lower() == "true":
                return True
            if v.lower() == "false":
                return False
        return v

    @field_validator("raw_metadata", mode="before")
    @classmethod
    def _coerce_dict(cls, v: Any) -> Any:
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
        if v == "":
            return None
        return v
