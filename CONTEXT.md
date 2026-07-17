# Cove

Cove is a self-hosted **media-acquisition tool** — the smart-downloader half that
Plex/Jellyfin lack (see ADR 0007). It downloads files and videos from direct links,
video sites, and streamhoster-backed pages (e.g. aniworld.to via VOE/Doodstream/
Filemoon), and writes them onto a Synology NAS with **Plex/Jellyfin-standard naming**
so those servers index and stream them. Playback, browsing, and transcoding are
**Plex/Jellyfin's job, not Cove's**; Cove offers only a light direct-play preview of
its *own* recent downloads.

Cove runs on the Synology itself as a Docker container. Sources are re-scanned manually
(no auto-poll); the Planner only decides *when* queued downloads run.

## Language

**Cove**:
The application itself (product name).

**Adapter**:
The pluggable extractor behind a **Source** type — it knows how to enumerate and pull
downloadable media from that kind of origin (aniworld/streamhoster page, RSS feed,
YouTube channel, watch-folder, direct link), plus that type's settings (preferred
streamhoster order, language, credentials).
_Avoid_: Extractor (reserved for the underlying yt-dlp mechanism), Plugin.

**Streamhoster**:
A third-party video host that an Adapter resolves a stream from (VOE, Doodstream,
Filemoon). Distinct from the **Adapter** for the page that embeds it.
_Avoid_: Mirror, host.

**Resolver**:
A swappable component that turns one **Streamhoster** embed URL into a concrete,
downloadable media URL/stream. Two kinds: external plugin resolvers the user supplies,
and a built-in generic headless-browser fallback that captures the stream a player
requests. Cove does not ship per-host deobfuscation resolvers.
_Avoid_: Extractor.

**Source**:
A saved origin Cove can enumerate downloadable items from and **re-scan on demand** —
never auto-polled. Has a type shown on the Sources screen: aniworld/streamhoster
series, RSS feed, YouTube channel, watch-folder, or direct link. Each Source is served
by exactly one **Adapter**. (The design's per-Source "check interval" is intentionally
dropped — see Flagged ambiguities.)
_Avoid_: Feed (implies auto-polling), subscription.

**Series**:
The show an aniworld/streamhoster-type **Source** targets; re-scanning that Source
enumerates its episodes into **Downloads**.
_Avoid_: Subscription, watchlist.

**Download**:
The unit of work — one file being fetched, with a state (queued, running, paused,
done, failed). What the **Planner** schedules and the **Catalog** eventually indexes.

**Batch**:
A bulk action that expands one input (a **Series**, an episode range, or a pasted
list) into many **Downloads** at once.

**Planner**:
The scheduler that decides *when* queued **Downloads** run — schedule windows
(e.g. overnight only) and bandwidth limits. It does NOT discover episodes or watch
series.
_Avoid_: Scheduler is fine as a synonym; do not let "planner" imply auto-watching.

**Schedule window**:
A configured time span (and optional bandwidth cap) during which the **Planner**
allows **Downloads** to run.

**Library** (destination):
A top-level bucket on the NAS that downloads land in (e.g. `Movies`, `TV`, `Anime`,
`Files`), organized with **Plex/Jellyfin-standard naming** so those servers index it:
`Movies/<Title> (Year)/<Title> (Year).ext`, `TV/<Show>/Season NN/<Show> - SxxEyy.ext`.

**Catalog**:
Cove's view of the media **actually present on the NAS** — a scan of the **Library**
destination folders is the **source of truth**, NOT Cove's download DB. So a reset DB, a
duplicate download, or a file deleted directly on the NAS all just reflect reality (no
phantom rows, no duplicates a folder can't have). Offers a light **direct-play preview**
(browser-native playback; no server transcoding) and delete (removes the file on disk).
The download DB tracks only in-flight work (queued/running/failed) — not what's "done".
_Avoid_: Library (that's the on-disk destination bucket).
_Avoid_: Library (that's the on-disk destination).

**Intake**:
Turning a natural-language request ("all of Frieren in German sub, 1080p") into a
structured download plan (Adapter + Series/URL + quality/language + Batch) via Claude,
for the user to confirm before it runs.
_Avoid_: Prompt, query.

**Triage**:
Deciding which **Variant** of each **Proposal** to download (or to skip it) — and, on a
messy/unknown page or a failed **Resolver**, reasoning about the next step. Performed by a
**Selector**: a deterministic policy or **Claude**.

**Proposal**:
An enumerated but **not-yet-committed** candidate from a **Source** re-scan (or a paste),
carrying its available **Variants** and awaiting **Triage**. Becomes a **Download** only
when confirmed. A **Source** produces Proposals — never **Downloads** directly.
_Avoid_: Candidate (fine in prose; in code it's Proposal).

**Variant**:
One concrete way to fetch a **Proposal**'s episode — a (**Streamhoster**, language) pair
(e.g. VOE / German Dub). A Proposal lists every Variant its **Adapter** found; **Triage**
picks one Variant (or skips the Proposal).

**Selector**:
The swappable module at the **Triage** seam that picks one **Variant** per **Proposal**
(or skips it). Two kinds: a deterministic **policy** (preferred **Streamhoster** order +
language) and **Claude** (reasons over the whole Proposal set). Same interface, so they're
interchangeable and testable in isolation.
_Avoid_: Filter, Chooser.

## Relationships

- A **Source** has a type and is served by exactly one **Adapter**; the user re-scans it on demand (no auto-poll)
- A **Source** re-scan produces **Proposals** (never **Downloads** directly); each Proposal lists its **Variants**
- An aniworld/streamhoster **Adapter** enumerates episodes and reports every **Variant** ((**Streamhoster**, language)) it found
- A **Selector** (policy or **Claude**) picks one **Variant** per **Proposal** during **Triage**; confirming turns chosen Proposals into **Downloads**
- A **Streamhoster** embed is turned into a downloadable stream by a **Resolver**
- A **Batch** expands a **Source** re-scan / episode range / pasted list into many **Proposals** (then **Downloads** on confirm)
- The **Planner** decides when queued **Downloads** run; it does not discover items
- A completed **Download** is written under a **Library** bucket with Plex/Jellyfin-standard naming, and appears in Cove's **Catalog**
- Plex/Jellyfin index those **Library** buckets and handle all browsing/streaming/transcoding

## Example dialogue

> **Dev:** "When you re-scan an aniworld **Source** and it finds 12 episodes, what runs them?"
> **User:** "That's a **Batch** — it makes 12 **Downloads**. The **Planner** just holds them until my overnight **Schedule window**."
> **Dev:** "And if the **Resolver** can't crack the **Streamhoster** for episode 7?"
> **User:** "That one **Download** goes to a failed state; the other 11 still run."

## Flagged ambiguities

- "source" now maps to the design's **Sources** screen: a typed, saved origin (aniworld,
  RSS, YouTube, watch-folder, direct link) served by one **Adapter**. It is not an
  umbrella over Adapters + Series any more.
- **Auto-polling declined.** The design shows a per-Source "check interval"; we do NOT
  build it. Sources are re-scanned manually; the **Planner** only schedules *when*
  queued **Downloads** run, never *discovery*.
- "Subscription" rejected: implied automatic watching, which Cove does not do.
