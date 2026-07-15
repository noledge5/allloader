"""Title / destination cleanup (ADR 0002 — Haiku tier).

Turns a messy filename or scene title into a clean library name and a
Plex/Jellyfin-style destination path. Deterministic, cheap, high-volume — so it
runs on the cheap model. Falls back to the raw title if AI is unavailable.
"""

from . import client

_TOOL = {
    "name": "clean_title",
    "description": "Return a cleaned display title plus a Plex/Jellyfin library and "
                   "destination subpath for a downloaded media file.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Human-readable title, no scene junk."},
            "library": {
                "type": "string",
                "enum": ["Movies", "TV", "Anime", "Music", "Files"],
                "description": "Top-level library bucket.",
            },
            "dest_rel": {
                "type": "string",
                "description": "Path within the library, Plex/Jellyfin style. "
                               "Movies: '<Title> (Year)'. "
                               "TV/Anime: '<Show>/Season NN'. Empty for Files/Music.",
            },
            "year": {"type": ["integer", "null"]},
        },
        "required": ["title", "library", "dest_rel"],
    },
}

_SYSTEM = (
    "You clean up media filenames for a self-hosted library that Plex and Jellyfin "
    "will read. Strip release-group tags, resolution/codec noise, dots and "
    "underscores. Follow Plex/Jellyfin naming conventions exactly. Be concise and "
    "never invent a year you are not confident about."
)


def clean(raw: str, kind: str = "video") -> dict:
    """Return {title, library, dest_rel, year?}. Raises AIError if unavailable."""
    return client.call_json(
        "cheap",
        _SYSTEM,
        f"kind={kind}\nfilename/title: {raw}",
        _TOOL["input_schema"],
        max_tokens=512,
    )
