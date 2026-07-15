# Cove is a full home media center (Plex replacement), not a downloader-with-preview

**Supersedes** the scope decisions in CONTEXT and ADR 0004 that framed Cove as a
"downloader with preview" sitting alongside Plex, and the grill decision that playback
would be "direct-play only."

**Decision.** Cove is a self-hosted home media center that also acquires media. It has
two halves:

1. **Acquisition** (already built in Phase 1 + planned adapters): downloads, Sources,
   Planner, NAS integration, Claude intake/triage.
2. **Media center** (new): a **library scanner** over the user's existing NAS media
   folders *and* Cove's downloads, an online **metadata agent** (TMDB/TVDB) for
   posters/titles/episode data with a filesystem-name fallback, and **on-the-fly
   ffmpeg transcoding** so any file (HEVC/MKV/4K) streams to any browser/phone/TV,
   direct-playing when the source is already device-compatible.

The user explicitly does not want to run Plex; Cove replaces it.

**Why it's recorded.** This is a large scope reversal with real consequences, and it
contradicts two earlier decisions a future reader would otherwise treat as settled
(preview-only scope; direct-play-only playback). It also sets the architectural
centerpiece: Cove now owns a media-library model and a transcoding pipeline, not just a
download queue.

**Consequences.**
- New domain concepts: **Library root**, **Media item**, **Metadata agent**,
  **Transcode/Stream** (see CONTEXT).
- Transcoding is CPU-heavy on the user's PC; a weak machine will struggle with 4K/HEVC.
  Direct-play is used whenever the source is already compatible to save CPU.
- The metadata agent adds an external dependency (TMDB/TVDB) and a free API key stored
  PC-local; it must degrade gracefully to filesystem-derived names when offline or
  unmatched.
- The Design's **Library** screen (poster grid, filters, preview player) already fits
  this; the preview modal becomes a real streaming player.
