"""Claude Selector — the AI adapter at the Triage seam (CONTEXT.md).

Given the whole Proposal set, Claude preselects one Variant per Proposal (or skips
it), honoring a language preference and sensible defaults (prefer a dub in the
wanted language, skip recaps/specials if the user asked). Degrades to the
deterministic PolicySelector whenever Claude isn't configured or errors.
"""

import json

from .. import ai
from .base import Selector
from .policy import PolicySelector

_SYSTEM = (
    "You are the Triage assistant in Cove, a self-hosted download manager. You get a "
    "list of episode Proposals; each lists the Variants it offers as (language, host). "
    "For each Proposal pick exactly one Variant index to download, or null to skip it. "
    "Prefer the host order voe > filemoon > vidoza > doodstream > streamtape when "
    "several match. Never invent indices. LANGUAGE RULE: if strict is true, pick a "
    "Variant ONLY in prefer_language and return null for any Proposal that has none "
    "(do not substitute another language). If strict is false, prefer prefer_language "
    "but fall back to the closest available."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "i": {"type": "integer", "description": "Proposal index."},
                    "j": {"type": ["integer", "null"], "description": "Chosen Variant index, or null to skip."},
                },
                "required": ["i", "j"],
            },
        }
    },
    "required": ["picks"],
}


class ClaudeSelector(Selector):
    name = "claude"

    def select(self, proposals, settings=None):
        settings = settings or {}
        if not ai.available():
            return PolicySelector().select(proposals, settings)
        try:
            return self._ask(proposals, settings)
        except Exception:
            return PolicySelector().select(proposals, settings)

    def _ask(self, proposals, settings):
        payload = {
            "prefer_language": settings.get("language") or "German Dub",
            "strict": settings.get("strict", True),
            "proposals": [
                {"i": i, "title": p.title,
                 "variants": [{"j": j, "language": v.language, "host": v.host}
                              for j, v in enumerate(p.variants)]}
                for i, p in enumerate(proposals)
            ],
        }
        out = ai.client.call_json("smart", _SYSTEM, json.dumps(payload), _SCHEMA)
        picks: list[int | None] = [None] * len(proposals)
        for pk in out.get("picks", []):
            i, j = pk.get("i"), pk.get("j")
            if isinstance(i, int) and 0 <= i < len(proposals):
                picks[i] = j if (isinstance(j, int) and 0 <= j < len(proposals[i].variants)) else None
        return picks
