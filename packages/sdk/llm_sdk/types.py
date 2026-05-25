from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class InferenceLog:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str | None = None
    provider: str = ""
    model: str = ""
    status: str = "success"  # 'success' | 'error'
    latency_ms: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    request_at: datetime | None = None
    response_at: datetime | None = None
    input_preview: str | None = None
    output_preview: str | None = None
    pii_redacted: bool = False
    raw_metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "provider": self.provider,
            "model": self.model,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "request_at": self.request_at.isoformat() if self.request_at else None,
            "response_at": self.response_at.isoformat() if self.response_at else None,
            "input_preview": self.input_preview,
            "output_preview": self.output_preview,
            "pii_redacted": self.pii_redacted,
            "raw_metadata": self.raw_metadata,
        }


@dataclass
class ChatOptions:
    conversation_id: str | None = None
    max_tokens: int = 8096
