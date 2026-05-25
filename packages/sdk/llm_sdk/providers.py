import json as _json
import os
import anthropic as _anthropic

from typing import Generator
from openai import OpenAI as _OpenAI
from google import genai as _genai
from google.genai import types as _genai_types


_COMPACTION_TRIGGER = int(os.environ.get("COMPACTION_TRIGGER_TOKENS", "25000"))
_COMPACTION_BETA = "compact-2026-01-12"
_MAX_TOKENS = 8096


def _mark_cacheable(msg: dict) -> None:
    content = msg.get("content")

    if isinstance(content, str):
        msg["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
    elif isinstance(content, list) and content:
        for block in reversed(content):
            if isinstance(block, dict) and block.get("type") == "text":
                block["cache_control"] = {"type": "ephemeral"}
                break


def _prepare_anthropic_messages(messages: list[dict]) -> list[dict]:
    result = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str) and content.startswith("["):
            try:
                parsed = _json.loads(content)
                if isinstance(parsed, list) and any(
                    isinstance(b, dict) and b.get("type") == "compaction"
                    for b in parsed
                ):
                    result.append({"role": msg["role"], "content": parsed})
                    continue
            except (_json.JSONDecodeError, ValueError):
                pass
        result.append(msg)

    if len(result) >= 2:
        _mark_cacheable(result[-2])

    return result


def _build_compaction_content(response_content) -> tuple[list[dict], str]:
    content_list: list[dict] = []
    text_parts: list[str] = []

    for block in response_content:
        btype = getattr(block, "type", None)
        if btype == "compaction":
            content_list.append({
                "type": "compaction",
                "content": getattr(block, "content", ""),
            })
        elif btype == "text":
            text = getattr(block, "text", "")
            content_list.append({"type": "text", "text": text})
            text_parts.append(text)

    return content_list, "".join(text_parts)


def anthropic_chat(messages: list[dict], model: str) -> dict:
    client = _anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    prepared = _prepare_anthropic_messages(messages)

    response = client.beta.messages.create(
        betas=[_COMPACTION_BETA],
        model=model,
        max_tokens=_MAX_TOKENS,
        messages=prepared,
        context_management={
            "edits": [{
                "type": "compact_20260112",
                "trigger": {"type": "input_tokens", "value": _COMPACTION_TRIGGER},
            }]
        },
    )

    has_compaction = any(
        getattr(b, "type", None) == "compaction" for b in response.content
    )

    if has_compaction:
        content_list, display_text = _build_compaction_content(response.content)
        return {
            "content": _json.dumps(content_list),
            "display_content": display_text,
            "prompt_tokens": response.usage.input_tokens,
            "completion_tokens": response.usage.output_tokens,
        }

    return {
        "content": response.content[0].text,
        "prompt_tokens": response.usage.input_tokens,
        "completion_tokens": response.usage.output_tokens,
    }


def anthropic_stream(
    messages: list[dict],
    model: str,
    compaction_out: list | None = None,
) -> Generator[str, None, None]:
    client = _anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prepared = _prepare_anthropic_messages(messages)

    with client.beta.messages.stream(
        betas=[_COMPACTION_BETA],
        model=model,
        max_tokens=_MAX_TOKENS,
        messages=prepared,
        context_management={
            "edits": [{
                "type": "compact_20260112",
                "trigger": {"type": "input_tokens", "value": _COMPACTION_TRIGGER},
            }]
        },
    ) as s:
        for text in s.text_stream:
            yield text

        if compaction_out is not None:
            final_msg = s.get_final_message()
            has_compaction = any(
                getattr(b, "type", None) == "compaction" for b in final_msg.content
            )
            if has_compaction:
                content_list, _ = _build_compaction_content(final_msg.content)
                compaction_out.append(content_list)


def openai_chat(messages: list[dict], model: str) -> dict:
    client = _OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    response = client.chat.completions.create(
        model=model,
        messages=messages,
    )

    choice = response.choices[0]
    usage = response.usage

    return {
        "content": choice.message.content,
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.completion_tokens,
    }


def openai_stream(messages: list[dict], model: str) -> Generator[str, None, None]:
    client = _OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
    )

    for chunk in response:
        content = chunk.choices[0].delta.content
        if content is None:
            continue
        yield content


_ROLE_MAP = {
    "user": "user",
    "assistant": "model",
    "system": "user",
}


def _convert_messages(
    messages: list[dict],
) -> tuple[str | None, list[_genai_types.Content], str]:
    system_instruction: str | None = None
    contents: list[_genai_types.Content] = []

    for msg in messages:
        role = msg.get("role", "user")
        text = msg.get("content", "")

        if role == "system" and system_instruction is None and not contents:
            system_instruction = text
        else:
            contents.append(
                _genai_types.Content(
                    role=_ROLE_MAP.get(role, "user"),
                    parts=[_genai_types.Part(text=text)],
                )
            )

    *history, last = contents
    last_prompt = last.parts[0].text if last else ""

    return system_instruction, history, last_prompt


def gemini_chat(messages: list[dict], model: str) -> dict:
    client = _genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    system_instruction, history, last_prompt = _convert_messages(messages)

    config_kwargs: dict = {}
    if system_instruction:
        config_kwargs["system_instruction"] = system_instruction

    if history:
        chat_session = client.chats.create(
            model=model,
            history=history,
            config=_genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None,
        )
        response = chat_session.send_message(last_prompt)
    else:
        response = client.models.generate_content(
            model=model,
            contents=last_prompt,
            config=_genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None,
        )

    content = response.text
    try:
        prompt_tokens = response.usage_metadata.prompt_token_count or 0
        completion_tokens = response.usage_metadata.candidates_token_count or 0
    except AttributeError:
        prompt_tokens = 0
        completion_tokens = 0

    return {
        "content": content,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }


def gemini_stream(messages: list[dict], model: str) -> Generator[str, None, None]:
    client = _genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    system_instruction, history, last_prompt = _convert_messages(messages)

    config_kwargs: dict = {}
    if system_instruction:
        config_kwargs["system_instruction"] = system_instruction

    config = _genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

    if history:
        chat_session = client.chats.create(
            model=model,
            history=history,
            config=config,
        )
        for chunk in chat_session.send_message_stream(last_prompt):
            if chunk.text:
                yield chunk.text
    else:
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=last_prompt,
            config=config,
        ):
            if chunk.text:
                yield chunk.text


_REGISTRY: dict[str, tuple] = {
    "anthropic": (anthropic_chat, anthropic_stream),
    "openai":    (openai_chat,    openai_stream),
    "gemini":    (gemini_chat,    gemini_stream),
}


def route(provider: str, messages: list[dict], model: str) -> dict:
    entry = _REGISTRY.get(provider)
    if entry is None:
        raise ValueError(
            f"Unknown provider '{provider}'. Must be one of: {', '.join(_REGISTRY)}"
        )
    chat_fn, _ = entry
    return chat_fn(messages, model)


def route_stream(
    provider: str,
    messages: list[dict],
    model: str,
    compaction_out: list | None = None,
) -> Generator[str, None, None]:
    entry = _REGISTRY.get(provider)
    if entry is None:
        raise ValueError(
            f"Unknown provider '{provider}'. Must be one of: {', '.join(_REGISTRY)}"
        )
    _, stream_fn = entry
    # compaction_out is Anthropic-only; other providers ignore it
    if provider == "anthropic" and compaction_out is not None:
        return stream_fn(messages, model, compaction_out=compaction_out)
    return stream_fn(messages, model)
