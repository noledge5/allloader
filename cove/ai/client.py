"""Thin wrapper around the Anthropic SDK (ADR 0002).

Everything funnels through here so the tiered-model policy, prompt caching, and
the "no key configured" graceful path live in one place. Nothing else in the AI
layer imports `anthropic` directly.
"""

import os

from .. import config

# The SDK is a hard dependency (requirements.txt) but we import lazily so a
# broken/absent install degrades to "AI unavailable" instead of crashing import.
try:
    import anthropic  # noqa: F401
    _SDK = True
except Exception:  # pragma: no cover - only when the wheel is missing
    _SDK = False


class AIError(Exception):
    """Raised for any AI-layer failure the API surfaces to the user."""


def _key() -> str:
    # config snapshots the env at import; re-read so a key set after launch works.
    return config.ANTHROPIC_API_KEY or os.environ.get("ANTHROPIC_API_KEY", "")


def available() -> bool:
    """True when we can actually call Claude — SDK present and a key configured."""
    return bool(_SDK and _key())


def status() -> dict:
    """Small dict the GUI polls to decide whether to show the Claude features."""
    return {
        "configured": available(),
        "sdk": _SDK,
        "models": {
            "cheap": config.MODEL_CHEAP,
            "smart": config.MODEL_SMART,
            "max": config.MODEL_MAX,
        },
    }


def _client():
    if not _SDK:
        raise AIError("The anthropic SDK is not installed.")
    if not _key():
        raise AIError("No ANTHROPIC_API_KEY configured.")
    return anthropic.Anthropic(api_key=_key())


def _system_blocks(system: str):
    """Wrap the system prompt as a cacheable block (prompt caching, ADR 0002).

    Cove's system prompts are long and reused across calls, so caching them cuts
    cost/latency on repeat requests within the 5-minute window.
    """
    return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]


def call_text(model: str, system: str, user: str, max_tokens: int = 1024) -> str:
    """One-shot text completion. Returns the concatenated text blocks."""
    try:
        msg = _client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=_system_blocks(system),
            messages=[{"role": "user", "content": user}],
        )
    except AIError:
        raise
    except Exception as e:  # pragma: no cover - network/SDK errors
        raise AIError(str(e)) from e
    return "".join(b.text for b in msg.content if b.type == "text").strip()


def call_tool(
    model: str,
    system: str,
    user: str,
    tool: dict,
    max_tokens: int = 2048,
) -> dict:
    """Force a single structured tool call and return its `input` dict.

    `tool` is one Anthropic tool schema. We pin `tool_choice` to it so Claude has
    to answer in the shape we want — this is how intake/naming return JSON we can
    trust instead of parsing prose.
    """
    try:
        msg = _client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=_system_blocks(system),
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"]},
            messages=[{"role": "user", "content": user}],
        )
    except AIError:
        raise
    except Exception as e:  # pragma: no cover - network/SDK errors
        raise AIError(str(e)) from e
    for block in msg.content:
        if block.type == "tool_use":
            return dict(block.input)
    raise AIError("Model did not return the expected structured answer.")


def converse(model: str, system: str, messages: list, tools: list, max_tokens: int = 1536):
    """Low-level passthrough for the chat tool-loop — returns the raw SDK message.

    The caller owns the running `messages` list and appends tool_result turns; this
    just wraps auth, caching, and error translation.
    """
    try:
        return _client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=_system_blocks(system),
            tools=tools,
            messages=messages,
        )
    except AIError:
        raise
    except Exception as e:  # pragma: no cover - network/SDK errors
        raise AIError(str(e)) from e
