# Cove

Cove is a self-hosted downloader for files and videos with a streaming/media-center
style GUI. It fetches from direct links, video sites, and streamhoster-backed pages
(e.g. aniworld.to via VOE/Doodstream/Filemoon), deposits finished files onto a
Synology NAS, and lets you preview its own download catalog in the browser. It runs
on the user's Windows PC; the NAS is a storage target, not a host. Cove does not
auto-watch series — discovery is manual — and its planner only decides *when* queued
downloads run.

## Language

**Cove**:
The application itself (product name).

**Adapter**:
A pluggable component that knows how to extract downloadable media from one kind of
site (aniworld.to, YouTube, direct link), plus that site's settings — preferred
streamhoster order, language, credentials.
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

**Series**:
A show the user has saved in Cove (typically an aniworld title). Remembered for
organization, quick re-open, and manual "re-scan for episodes" — NOT automatically
polled. Served by exactly one **Adapter**.
_Avoid_: Subscription (implies auto-updating, which Cove does not do), show, watchlist.

**Source**:
Umbrella term for the two things "manage sources" covers: **Adapters** (how Cove
extracts) and saved **Series** (what the user has added). Not a single entity.

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

**Library**:
A top-level destination bucket on the NAS (e.g. Anime, Movies, Files) under which
Cove organizes downloads into simple per-series/per-source folders. Cove is the only
component that has to understand this tree — no external media server indexes it.

**Catalog**:
Cove's browsable index of its own finished downloads, and the surface the preview UI
shows. Reads the same tree Cove writes to; not a scan of the user's whole NAS.
_Avoid_: Library (that's the on-disk destination), media library.

**Intake**:
Turning a natural-language request ("all of Frieren in German sub, 1080p") into a
structured download plan (Adapter + Series/URL + quality/language + Batch) via Claude,
for the user to confirm before it runs.
_Avoid_: Prompt, query.

**Triage**:
Claude reasoning over a messy/unknown page or a failed **Resolver** to decide the next
step — enumerate episodes, pick a **Streamhoster**, or suggest an alternate approach.

## Relationships

- An **Adapter** enumerates media on a page and picks one of several **Streamhosters** in a preferred order
- A **Streamhoster** embed is turned into a downloadable stream by a **Resolver**
- A **Series** is served by exactly one **Adapter**; a manual re-scan enumerates its episodes
- A **Batch** expands a **Series** / range / list into many **Downloads**
- The **Planner** decides when queued **Downloads** run; it does not discover episodes
- The **Catalog** indexes finished **Downloads** under **Library** roots

## Example dialogue

> **Dev:** "When you re-scan a **Series** and it finds 12 episodes, what runs them?"
> **User:** "That's a **Batch** — it makes 12 **Downloads**. The **Planner** just holds them until my overnight **Schedule window**."
> **Dev:** "And if the **Resolver** can't crack the **Streamhoster** for episode 7?"
> **User:** "That one **Download** goes to a failed state; the other 11 still run."

## Flagged ambiguities

- "source" was used for the whole management area. Resolved: umbrella over **Adapter**
  (how we extract, swappable) and **Series** (what you saved, stable). Prefer the specific term.
- "Subscription" rejected: it implied automatic new-episode watching, which Cove does
  NOT do. Use **Series**; discovery is always a manual re-scan.
- "planner" scoped to scheduling only (when **Downloads** run), never episode discovery.
