# Ship a built-in VOE resolver (refines ADR 0001)

**Refines ADR 0001** ("Cove ships no per-host deobfuscation; resolvers are
user-supplied plugins + a generic headless fallback").

**Context.** In practice ADR 0001's two shipped paths both fall short for the
headline use case (aniworld):
- **yt-dlp does not help.** The current yt-dlp deliberately dropped/blocked these
  hosters — Filemoon is flagged `KnownPiracy` and refused; VOE, Doodstream,
  Streamtape, Vidoza have no extractor and fall through to the generic handler,
  which can't crack them.
- **The headless fallback is too heavy to be the only path** on the target
  hardware — a low-power ARM Synology — and some hosts still evade a network sniff.

So a fresh install downloaded nothing from aniworld: episodes enumerated, but the
resolve step never produced a stream. The user explicitly asked for it to work.

**Decision.** Ship one **built-in host resolver for VOE** (aniworld's default
hoster), tried ahead of user plugins and the headless fallback:
- Pure HTTP + parsing (no browser), so it's light enough for the NAS.
- Layered strategies (obfuscated JSON blob, `hls` base64 key, `sources` literal,
  bare HLS/MP4 regex) so it survives minor format changes; returns None when it
  can't, handing off to the headless resolver.
- The download path passes the embed URL as `Referer` so the CDN doesn't 403 the
  `.m3u8`.

The resolver chain is now: **VOE (built-in) → user plugins → headless sniffer.**

**Consequences.**
- Cove now contains a small amount of host-specific extraction — a deliberate,
  scoped exception to ADR 0001's "ship nothing," limited to the one dominant host.
  Other hosts (Doodstream, Filemoon, …) still rely on the headless fallback or a
  user plugin.
- It is **brittle by nature**: when VOE changes its scheme it breaks until updated.
  This is accepted and documented, not a defect.
- Lawful use is the operator's responsibility; Cove is a general acquisition tool.
- ADR 0001's plugin slot and headless fallback are unchanged; this only adds a
  built-in ahead of them.
