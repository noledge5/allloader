"""AI provider backends (ADR 0002).

Two ways to reach Claude, chosen at runtime by COVE_AI_PROVIDER:
  - "cli": the Claude Code CLI, authenticated with the user's Claude
    subscription via CLAUDE_CODE_OAUTH_TOKEN — no per-token bill.
  - "api": the Anthropic SDK with a metered API key.
  - "auto" (default): use the API key if one is set, otherwise the CLI.

Higher-level features only ever call complete()/call_text()/call_json(); the
backend split lives here. Everything degrades to "unavailable" cleanly when
neither backend is set up, so the rest of Cove keeps working without AI.
"""

import json
import os
import re
import shutil
import subprocess

from .. import config


class AIError(Exception):
    """Any AI-layer failure surfaced to the user."""


# A feature asks for a tier ("cheap"/"smart"/"max"); each backend maps it to a
# concrete model. The CLI uses short aliases so it works on whatever the
# subscription grants; the API uses the pinned ids from config.
_API_MODELS = {"cheap": config.MODEL_CHEAP, "smart": config.MODEL_SMART, "max": config.MODEL_MAX}
_CLI_MODELS = {
    "cheap": os.environ.get("COVE_CLI_MODEL_CHEAP", "haiku"),
    "smart": os.environ.get("COVE_CLI_MODEL_SMART", "sonnet"),
    "max": os.environ.get("COVE_CLI_MODEL_MAX", "opus"),
}

try:
    import anthropic
    _SDK = True
except Exception:  # pragma: no cover - only when the wheel is missing
    _SDK = False


def _api_key() -> str:
    return config.ANTHROPIC_API_KEY or os.environ.get("ANTHROPIC_API_KEY", "")


def _cli_bin() -> str | None:
    return os.environ.get("COVE_CLAUDE_BIN") or shutil.which("claude")


def active_provider() -> str | None:
    """Return 'api', 'cli', or None given COVE_AI_PROVIDER and what's configured."""
    choice = os.environ.get("COVE_AI_PROVIDER", "auto").strip().lower()
    api_ok = bool(_SDK and _api_key())
    cli_ok = bool(_cli_bin())
    if choice == "api":
        return "api" if api_ok else None
    if choice == "cli":
        return "cli" if cli_ok else None
    # auto: an explicit API key wins; otherwise fall back to the subscription CLI.
    if api_ok:
        return "api"
    if cli_ok:
        return "cli"
    return None


def available() -> bool:
    return active_provider() is not None


def status() -> dict:
    """Small dict the GUI polls to decide whether to show the Claude features."""
    p = active_provider()
    return {
        "configured": p is not None,
        "provider": p,
        "sdk": _SDK,
        "cli": bool(_cli_bin()),
        "models": _CLI_MODELS if p == "cli" else _API_MODELS,
    }


# -- backends ---------------------------------------------------------------

def _complete_api(tier: str, system: str, user: str, max_tokens: int) -> str:
    client = anthropic.Anthropic(api_key=_api_key())
    try:
        msg = client.messages.create(
            model=_API_MODELS[tier],
            max_tokens=max_tokens,
            # Cache the (long, reused) system prompt — cost/latency win on repeats.
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:  # pragma: no cover - network/SDK errors
        raise AIError(str(e)) from e
    return "".join(b.text for b in msg.content if b.type == "text").strip()


def _complete_cli(tier: str, system: str, user: str, max_tokens: int) -> str:
    bin_ = _cli_bin()
    # Fold system into the prompt so we don't depend on a specific --system flag.
    prompt = f"{system}\n\n{user}" if system else user
    cmd = [bin_, "-p", prompt, "--output-format", "json", "--model", _CLI_MODELS[tier]]
    extra = os.environ.get("COVE_CLAUDE_ARGS")
    if extra:
        cmd += extra.split()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired as e:
        raise AIError("Claude Code CLI timed out.") from e
    except Exception as e:
        raise AIError(f"Could not run the Claude Code CLI: {e}") from e
    if proc.returncode != 0:
        raise AIError((proc.stderr or proc.stdout or "Claude Code CLI failed").strip()[:400])
    out = (proc.stdout or "").strip()
    # `--output-format json` wraps the answer in an envelope; pull out .result.
    try:
        env = json.loads(out)
        if isinstance(env, dict) and "result" in env:
            return str(env["result"]).strip()
    except ValueError:
        pass
    return out


def complete(tier: str, system: str, user: str, max_tokens: int = 1024) -> str:
    p = active_provider()
    if p == "api":
        return _complete_api(tier, system, user, max_tokens)
    if p == "cli":
        return _complete_cli(tier, system, user, max_tokens)
    raise AIError("No AI provider configured.")


# -- text / structured helpers (backend-agnostic) --------------------------

def call_text(tier: str, system: str, user: str, max_tokens: int = 1024) -> str:
    return complete(tier, system, user, max_tokens)


_JSON_RE = re.compile(r"\{.*\}", re.S)


def call_json(tier: str, system: str, user: str, schema: dict, max_tokens: int = 2048) -> dict:
    """Ask for structured output and parse it. Works on both backends by
    instructing JSON-only output (the API's tool_choice isn't available on the CLI).
    """
    sys2 = (system + "\n\nRespond with ONLY a single JSON object — no prose, no "
            "markdown fences — matching this JSON schema:\n" + json.dumps(schema))
    return _parse_json(complete(tier, sys2, user, max_tokens))


def _parse_json(raw: str) -> dict:
    s = raw.strip()
    if s.startswith("```"):
        # Strip a ```json … ``` fence if the model added one anyway.
        parts = s.split("```")
        if len(parts) >= 2:
            s = parts[1]
            if s.lstrip().lower().startswith("json"):
                s = s.lstrip()[4:]
    s = s.strip()
    try:
        return json.loads(s)
    except ValueError:
        m = _JSON_RE.search(raw)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                pass
    raise AIError("Model did not return valid JSON.")
