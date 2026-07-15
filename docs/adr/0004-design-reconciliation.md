# The Cove Design is the UI spec, with two deliberate deviations

The user supplied a finished visual design (`design/Cove Downloader.dc.html`, a Claude
Design export that compiles to React). It defines the four sections (Dashboard,
Library, Sources, Planner), the Claude "Download Assistant" panel, and the New
Download / NAS-browser / Batch / Preview modals, plus the palette (`#0c0f0e` bg, mint
`#97f0ae` accent) and type (Plus Jakarta Sans + Noto Serif).

**Decision.** Treat the design as the authoritative UI spec and build the frontend to
match it, with two deliberate deviations where it conflicts with earlier ADRs/CONTEXT:

1. **Sources are manual re-scan, not auto-polled.** The design shows a per-Source
   "check interval" (every 15 min / hourly / daily) and live "found N / last checked"
   status. We do **not** build interval polling — Sources are re-scanned on demand, and
   the **Planner** stays a pure scheduler (ADR: planner is scheduling-only). The
   interval control is removed from the Sources UI.
2. **aniworld/streamhosters are a first-class Source type.** The design's Source types
   are RSS / YouTube / watch-folder / direct link; we add aniworld/streamhoster as
   another selectable Source type on the same screen, backed by the **Resolver**
   architecture in ADR 0001 (which stands).

**Why it's recorded.** A future reader comparing the shipped app to the original design
export will see the missing interval control and the extra Source type and wonder if
they were mistakes. They were deliberate reconciliations of the design against the
grilled backend model.
