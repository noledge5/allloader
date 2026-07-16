"""Deterministic Selector — the default policy at the Triage seam.

Picks, per Proposal: keep only Variants in the wanted language (skip the Proposal
if none and `strict`), then choose by preferred Streamhoster order. No network, no
Claude — this is also the fallback whenever the Claude Selector can't run.
"""

from ..adapters.aniworld import DEFAULT_HOSTER_ORDER, DEFAULT_LANGUAGE
from .base import Selector


class PolicySelector(Selector):
    name = "policy"

    def select(self, proposals, settings=None):
        settings = settings or {}
        language = settings.get("language", DEFAULT_LANGUAGE) or None
        strict = settings.get("strict", True)
        order = [h.lower() for h in settings.get("hosters", DEFAULT_HOSTER_ORDER)]
        return [self._pick(p.variants, language, strict, order) for p in proposals]

    def _pick(self, variants, language, strict, order):
        cands = list(enumerate(variants))
        if language:
            same = [(i, v) for i, v in cands if v.language == language]
            if same:
                cands = same
            elif strict:
                return None  # no Variant in the wanted language → skip Proposal
        if not cands:
            return None

        def rank(iv):
            host = iv[1].host or ""
            for k, name in enumerate(order):
                if name in host:
                    return k
            return len(order)

        return sorted(cands, key=rank)[0][0]
