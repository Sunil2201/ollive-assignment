"""
All LLM provider implementations and the routing layer.

Provider functions read API keys from environment variables at call time
so the module can be imported without keys present.
"""

import os
from typing import Generator

# ── Anthropic ──────────────────────────────────────────────────────────────────

import anthropic as _anthropic

#TODO: add 8096 to constants

def anthropic_chat(messages: list[dict], model: str) -> dict:
    client = _anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    response = client.messages.create(
        model=model,
        max_tokens=8096,
        messages=messages,
    )

    return {
        "content": response.content[0].text,
        "prompt_tokens": response.usage.input_tokens,
        "completion_tokens": response.usage.output_tokens,
    }


def anthropic_stream(messages: list[dict], model: str) -> Generator[str, None, None]:
    client = _anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    with client.messages.stream(
        model=model,
        max_tokens=8096,
        messages=messages,
    ) as s:
        for text in s.text_stream:
            yield text


# ── OpenAI ─────────────────────────────────────────────────────────────────────

from openai import OpenAI as _OpenAI


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


# ── Gemini ─────────────────────────────────────────────────────────────────────

from google import genai as _genai
from google.genai import types as _genai_types

# Map standard OpenAI-style roles to Gemini roles
_ROLE_MAP = {
    "user": "user",
    "assistant": "model",
    "system": "user",  # handled separately as system_instruction
}


def _convert_messages(
    messages: list[dict],
) -> tuple[str | None, list[_genai_types.Content], str]:
    """
    Split out a leading system message and convert the rest to
    google.genai Content objects.

    Returns (system_instruction, history_contents, last_user_prompt).
    """
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

    # Separate history from the final prompt so we can use the chat API
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

    # Token counts may or may not be populated depending on the model/version
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


# ── Router ─────────────────────────────────────────────────────────────────────

_REGISTRY: dict[str, tuple] = {
    "anthropic": (anthropic_chat, anthropic_stream),
    "openai":    (openai_chat,    openai_stream),
    "gemini":    (gemini_chat,    gemini_stream),
}


def route(provider: str, messages: list[dict], model: str) -> dict:
    """Dispatch a blocking chat call to the appropriate provider."""
    entry = _REGISTRY.get(provider)
    if entry is None:
        raise ValueError(
            f"Unknown provider '{provider}'. Must be one of: {', '.join(_REGISTRY)}"
        )
    chat_fn, _ = entry
    return chat_fn(messages, model)


def route_stream(provider: str, messages: list[dict], model: str) -> Generator[str, None, None]:
    """Dispatch a streaming call to the appropriate provider."""
    entry = _REGISTRY.get(provider)
    if entry is None:
        raise ValueError(
            f"Unknown provider '{provider}'. Must be one of: {', '.join(_REGISTRY)}"
        )
    _, stream_fn = entry
    return stream_fn(messages, model)
