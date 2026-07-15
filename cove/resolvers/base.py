"""Resolver base type. A Resolver turns a streamhoster embed URL into a concrete,
downloadable media URL (usually an .m3u8 or .mp4)."""


class Resolver:
    name: str = "base"

    def matches(self, url: str) -> bool:
        """Whether this resolver wants to handle the embed URL."""
        return False

    def resolve(self, url: str) -> str | None:
        """Return a concrete media URL, or None if it can't."""
        raise NotImplementedError
