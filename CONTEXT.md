# Cove

Cove is a self-hosted **home media center that also acquires media** — a Plex/Jellyfin
replacement, not a downloader-with-preview (see ADR 0006). It has two halves:

- **Acquisition** — downloads files and videos from direct links, video sites, and
  streamhoster-backed pages (e.g. aniworld.to via VOE/Doodstream/Filemoon), deposits
  them onto a Synology NAS. Sources are re-scanned manually (no auto-poll); the Planner
  only decides *when* queued downloads run.
- **Media center** — scans the whole NAS media library (existing files + Cove's
  downloads) into a browsable **Library**, enriches it with online metadata + artwork,
  and streams anything to a browser/phone/TV via on-the-fly transcoding.

It runs on the user's Windows PC; the NAS is a storage target, not a host.

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

**Library**:
The browsable, streamable collection Cove presents — built by scanning one or more
**Library roots** into **Media items** with metadata. Covers the user's existing NAS
media *and* Cove's downloads (ADR 0006). Also used loosely for a top-level destination
bucket (Anime/Movies/Files) that downloads land in; context disambiguates.

**Library root**:
A NAS folder Cove scans for media (e.g. `/volume1/Movies`, `/volume1/Anime`). One of
several the user configures; the download destination buckets are library roots too.

**Media item**:
One catalogued thing in the **Library** — a movie, a show episode, or a music track —
with a path, container/codec info, and (when matched) metadata: title, poster,
season/episode, description.
_Avoid_: Catalog entry (Catalog is retired in favor of Library + Media item).

**Metadata agent**:
The component that enriches **Media items** with posters/titles/episode data from an
online source (TMDB/TVDB), falling back to filesystem-derived names when offline or
unmatched.

**Transcode / Stream**:
Serving a **Media item** for playback. Cove direct-plays when the source codec/container
is already device-compatible, and otherwise transcodes on the fly with ffmpeg so
HEVC/MKV/4K play in any browser/phone/TV.

**Intake**:
Turning a natural-language request ("all of Frieren in German sub, 1080p") into a
structured download plan (Adapter + Series/URL + quality/language + Batch) via Claude,
for the user to confirm before it runs.
_Avoid_: Prompt, query.

**Triage**:
Claude reasoning over a messy/unknown page or a failed **Resolver** to decide the next
step — enumerate episodes, pick a **Streamhoster**, or suggest an alternate approach.

## Relationships

- A **Source** has a type and is served by exactly one **Adapter**; the user re-scans it on demand (no auto-poll)
- An aniworld/streamhoster **Adapter** enumerates episodes and picks one of several **Streamhosters** in a preferred order
- A **Streamhoster** embed is turned into a downloadable stream by a **Resolver**
- A **Batch** expands a **Source** re-scan / episode range / pasted list into many **Downloads**
- The **Planner** decides when queued **Downloads** run; it does not discover items
- A completed **Download** lands under a **Library root** and is picked up by the scan as a **Media item**
- The library scan turns files under **Library roots** into **Media items**, which the **Metadata agent** enriches
- Playing a **Media item** direct-plays or **Transcode**s it to the requesting device

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
