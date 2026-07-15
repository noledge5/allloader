# Cove is an acquisition tool on the Synology; Plex/Jellyfin do playback

**Supersedes ADR 0006** (full media-center / transcoding pivot) and revises the
original topology and library-naming decisions.

**Context.** A transcoding media server is the wrong thing to run on a Synology — the
NAS CPU is weak, and Plex/Jellyfin already do library browsing + hardware-accelerated
(QuickSync) transcoding natively on the box. Cove's unique value is the half those
tools lack: smart *acquisition* (resumable downloads, aniworld/streamhoster resolving,
Claude intake/triage, Sources, Planner).

**Decision.**
- **Cove = acquisition + light preview.** It downloads and organizes media, and offers
  a light **direct-play** preview of its *own* recent downloads (no server transcoding).
  It does not browse or stream the whole NAS library — Plex or Jellyfin does that.
- **Runs on the Synology** as a Docker container (Container Manager), not on the PC.
  The download engine, FastAPI, SQLite, and Planner are all light and NAS-friendly;
  this makes Cove always-on and local to the storage. (Reverses the earlier
  "runs on the user's PC" topology.)
- **Output is Plex/Jellyfin-standard.** Because those servers now index Cove's output,
  downloads are written with media-server-standard layout/naming
  (`Movies/<Title> (Year)/...`, `TV/<Show>/Season NN/<Show> - SxxEyy.ext`) so their
  scanners pick them up automatically. (Reverses the earlier "simple Cove-only folders,
  no external indexer" decision.)

**Consequences.**
- The **media-library scanner**, **metadata agent**, and **transcoding/streaming**
  work (Phases dropped) are not built — Plex/Jellyfin own that.
- Cove's own "Library"/Catalog view is just its downloaded items with a direct-play
  preview, matching the design's Library screen scoped to Cove's grabs.
- Packaging shifts from a Windows `start.bat` to a **Dockerfile + compose** for Synology
  Container Manager; config (NAS volume path, Anthropic key) comes via env/compose.
- ADR 0003 (LAN-reachable, no auth) still holds; ADR 0001 (resolvers), 0002 (Claude
  tiers), 0004 (design as UI spec), 0005 (FastAPI + React bundle) all stand.
