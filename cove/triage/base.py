"""Selector base type (CONTEXT.md: the Triage seam).

A Selector looks at a list of Proposals (each with its Variants) and returns, per
Proposal, the index of the chosen Variant — or None to skip that Proposal. Two
adapters satisfy this: a deterministic policy and Claude. Same interface, so they
are interchangeable and testable in isolation.
"""


class Selector:
    name: str = "base"

    def select(self, proposals: list, settings: dict | None = None) -> list[int | None]:
        """Return one chosen Variant index (or None) per Proposal, same length/order."""
        raise NotImplementedError
