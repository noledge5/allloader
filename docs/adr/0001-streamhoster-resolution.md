# Streamhoster resolution via pluggable resolvers, not built-in circumvention

Mainline yt-dlp deliberately refuses the streamhosters Cove targets: it ships a
`KnownPiracyIE` matcher that blocks `filemoon.sx`, `dood.*` and similar as known
piracy hosts, and has no working extractor for VOE (it falls to the generic handler,
which can't defeat the obfuscated player). So Cove cannot lean on yt-dlp for the
hoster leg.

**Decision.** Cove ships an Adapter/**Resolver** framework where streamhoster
resolution is a swappable slot, plus a *generic* (not host-specific) headless-browser
fallback that captures the media stream a player requests. Cove builds the aniworld
page-parsing (episode/hoster enumeration) and uses yt-dlp for legitimately-supported
sites. Cove does **not** ship per-host deobfuscation resolvers for the named piracy
hosters; those are external plugins the user supplies.

**Why it's recorded.** A future reader will otherwise ask "why the plugin slot and a
browser sniffer instead of just calling yt-dlp?" — the answer is the upstream piracy
block above. The boundary (framework + generic fallback yes; bespoke per-host
circumvention no) is deliberate, not an oversight.

**Consequences.** The headless-browser fallback pulls in a bundled Chromium (heavier
install) and can still fail against hosts with active anti-bot measures; those failures
are surfaced as a first-class "resolver failed" state rather than silently retried.
