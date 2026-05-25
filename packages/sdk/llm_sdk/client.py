from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Generator

from .context import count_tokens, trim_context
from .providers import route, route_stream
from .redactor import redact_pii
from .transport import LogTransport
from .types import ChatOptions, InferenceLog

PROVIDER_MODELS: dict[str, str] = {
    "anthropic": "claude-sonnet-4-6",
    "openai":    "gpt-4.1-mini",
    "gemini":    "gemini-2.0-flash",
}


class LLMClient:
    def __init__(
        self,
        transport: LogTransport | None = None,
        trim: bool = True,
    ) -> None:
        self._transport = transport or LogTransport()
        self._trim = trim


    def _resolve_model(self, provider: str) -> str:
        model = PROVIDER_MODELS.get(provider)
        if model is None:
            raise ValueError(
                f"Unknown provider '{provider}'. "
                f"Must be one of: {', '.join(PROVIDER_MODELS)}"
            )
        return model

    def _input_preview(self, messages: list[dict]) -> tuple[str, bool]:
        return redact_pii(str(messages)[:500])


    def chat(
        self,
        provider: str,
        messages: list[dict],
        options: ChatOptions | None = None,
    ) -> dict:
        options = options or ChatOptions()
        model = self._resolve_model(provider)

        if self._trim:
            messages = trim_context(messages, provider, model)

        input_preview, pii_redacted = self._input_preview(messages)

        log = InferenceLog(
            conversation_id=options.conversation_id,
            provider=provider,
            model=model,
            request_at=datetime.now(tz=timezone.utc),
            input_preview=input_preview,
            pii_redacted=pii_redacted,
        )

        t0 = time.monotonic()
        try:
            result = route(provider, messages, model)

            output_preview, out_pii = redact_pii(result.get("content", "")[:500])

            log.status = "success"
            log.prompt_tokens = result.get("prompt_tokens")
            log.completion_tokens = result.get("completion_tokens")
            log.total_tokens = (
                (result.get("prompt_tokens") or 0)
                + (result.get("completion_tokens") or 0)
            ) or None
            log.output_preview = output_preview
            if out_pii:
                log.pii_redacted = True

            return result

        except Exception as exc:
            log.status = "error"
            log.error_code = type(exc).__name__
            log.error_message = str(exc)[:500]
            raise

        finally:
            log.response_at = datetime.now(tz=timezone.utc)
            log.latency_ms = int((time.monotonic() - t0) * 1000)
            self._transport.send(log)


    def stream(
        self,
        provider: str,
        messages: list[dict],
        options: ChatOptions | None = None,
        compaction_out: list | None = None,
    ) -> Generator[str, None, None]:
        options = options or ChatOptions()
        model = self._resolve_model(provider)

        if self._trim:
            messages = trim_context(messages, provider, model)

        input_preview, pii_redacted = self._input_preview(messages)

        log = InferenceLog(
            conversation_id=options.conversation_id,
            provider=provider,
            model=model,
            request_at=datetime.now(tz=timezone.utc),
            input_preview=input_preview,
            pii_redacted=pii_redacted,
        )

        t0 = time.monotonic()
        full: list[str] = []

        try:
            for chunk in route_stream(provider, messages, model, compaction_out=compaction_out):
                full.append(chunk)
                yield chunk

            response_text = "".join(full)
            output_preview, out_pii = redact_pii(response_text[:500])

            log.status = "success"
            log.output_preview = output_preview
            if out_pii:
                log.pii_redacted = True

            log.prompt_tokens = count_tokens(messages, provider, model)
            log.completion_tokens = len(response_text) // 4
            log.total_tokens = log.prompt_tokens + log.completion_tokens

        except Exception as exc:
            log.status = "error"
            log.error_code = type(exc).__name__
            log.error_message = str(exc)[:500]
            raise

        finally:
            log.response_at = datetime.now(tz=timezone.utc)
            log.latency_ms = int((time.monotonic() - t0) * 1000)
            self._transport.send(log)
