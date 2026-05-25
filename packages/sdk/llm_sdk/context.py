import os
import sys


def count_tokens(messages: list[dict], provider: str, model: str) -> int:
    try:
        if provider == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            non_system = [m for m in messages if m["role"] != "system"]
            response = client.messages.count_tokens(
                model=model,
                messages=non_system,
            )
            return response.input_tokens

        elif provider == "openai":
            import tiktoken

            try:
                enc = tiktoken.encoding_for_model(model)
            except Exception:
                # tiktoken may not recognise newer model names (e.g. gpt-4.1-mini)
                # and can raise KeyError or RecursionError during registry lookup.
                # cl100k_base is the correct encoding for all GPT-4 family models.
                enc = tiktoken.get_encoding("cl100k_base")

            total = 0
            for msg in messages:
                total += 4  # role + formatting overhead per message
                total += len(enc.encode(msg.get("content", "")))
            return total

        elif provider == "gemini":
            from google import genai

            client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
            converted = []
            for m in messages:
                role = "model" if m["role"] == "assistant" else "user"
                converted.append(
                    {"role": role, "parts": [{"text": m.get("content", "")}]}
                )

            response = client.models.count_tokens(
                model=model,
                contents=converted,
            )
            return response.total_tokens

        else:
            return len(str(messages)) // 4

    except Exception as exc:
        print(
            f"WARNING: token counting failed ({exc}), falling back to heuristic",
            file=sys.stderr,
        )
        return len(str(messages)) // 4


def trim_context(
    messages: list[dict],
    provider: str,
    model: str,
    max_tokens: int | None = None,
) -> list[dict]:
    if max_tokens is None:
        raw = os.environ.get("MAX_CONTEXT_TOKENS", "")
        try:
            max_tokens = int(raw)
        except (ValueError, TypeError):
            max_tokens = 8000

    system_msgs = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]
    kept: list[dict] = []

    for msg in reversed(non_system):
        candidate = [msg] + kept
        token_count = count_tokens(system_msgs + candidate, provider, model)

        if token_count > max_tokens and len(kept) >= 2:
            break

        kept = candidate

    result = system_msgs + kept
    token_count = count_tokens(result, provider, model)
    print(f"Context: {len(result)} messages, ~{token_count} tokens")
    return result
