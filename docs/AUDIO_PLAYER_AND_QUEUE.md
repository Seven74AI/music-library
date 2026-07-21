# Audio Player & Queue System - Product Documentation

## Overview

The Music Library application features a sophisticated audio player with a context-aware queue system that provides a seamless music listening experience. The system intelligently manages playback, queue loading, and user interactions across different contexts (library, playlists) while maintaining optimal performance even with large music collections (5,000+ tracks).

---

## Audio Player

### What It Is

The audio player is a persistent, bottom-fixed control bar that appears when a user starts playing music. It provides all essential playback controls and track information in a compact, always-accessible interface.

### Key Features

#### 1. **Persistent Playback Control**

- **Fixed Position**: The player stays at the bottom of the screen, visible across all pages
- **Always Accessible**: Users can control playback from anywhere in the application
- **Auto-Play**: When a track is selected, playback begins automatically (respecting browser autoplay policies)

#### 2. **Playback Controls**

- **Play/Pause Button**: Large, prominent button in the center for easy access
- **Previous/Next Track**: Navigate through the queue with arrow buttons
- **Seek Bar**: Interactive progress bar showing current position and total duration
  - Users can click or drag to jump to any point in the track
  - Displays current time and total duration in MM:SS format
- **Close Button**: Minimize the player (stops playback and clears queue)

#### 3. **Advanced Playback Modes**

**Loop Modes** (3 states, cycles through):

- **Off**: Normal playback, stops at end of queue
- **All**: Loops entire queue continuously
- **One**: Loops the current track indefinitely
  - Visual indicator: Button shows active state with "1" badge when looping one track

**Shuffle Mode**:

- Permutes spine play order using Fisher-Yates shuffle
- Visual indicator: Button highlights when active
- When toggled on mid-playback, reshuffles spine order from the current position onward (Up Next untouched)
- Works seamlessly with loop modes

#### 4. **Track Information Display**

- **Thumbnail**: Album art or placeholder icon if no cover available
- **Track Title**: Prominently displayed
- **Artist Name**: Shown below title
- **Consistent Placeholders**: Standardized icon for tracks without album art across the entire application

#### 5. **Smart Audio File Selection**

- Automatically selects the best available audio format
- Priority order: FLAC → WAV → MP3 → M4A → OGG → AAC → WebM → first available
- Ensures highest quality playback when multiple formats are available

#### 6. **Audio URL loading (production & local dev)**

- The player fetches `/resources/audio/:trackId` and receives a JSON `{ url }` (presigned Tigris URL in production; local stream URL in dev)
- Auto-play only runs after the URL for the **current** track has loaded (avoids races when skipping tracks)
- Navigation (next, previous, click another track) updates the current track immediately and keeps playback going when possible

---

## Queue System

### What It Is

The queue is a **three-zone**, context-aware playback model that scales from small playlists to massive libraries (5,000–15,000+ tracks). Instead of loading full track payloads for every row up front, the system loads a lightweight **spine** in one request and **hydrates** full playback data only for tracks about to play.

```
[ Now playing ] → [ Up Next (manual) ] → [ Spine (library or playlist) ]
```

### Key Concepts

#### 1. **Context-Aware Spine**

The spine is the ordered list of playable tracks for the active play context:

**Library Context**:

- When a user clicks play from their music library (or **Play library** on home)
- Spine loads all **playable** tracks from the user's library (tracks with at least one archived audio file)
- Metadata-only library entries (no audio files) are excluded
- Maintains library order among playable tracks

**Playlist Context**:

- When a user clicks play from a specific playlist
- Spine loads all **playable** tracks from that playlist
- Metadata-only playlist entries are excluded
- Maintains the playlist's track order among playable tracks

**Key Behavior**: The spine resets when switching contexts (library ↔ playlist). Up Next is cleared on a fresh play from a new context.

**API**: `GET /api/queue-spine?context=library&hasAudio=1` or `GET /api/queue-spine?context=playlist&playlistId=…`. Returns `{ tracks: QueueTrack[], total: number }` where each `QueueTrack` has `id`, `title`, and `artist` only.

#### 2. **Up Next (Manual Zone)**

User-injected tracks live in **Up Next** — an in-memory zone between now playing and the spine:

- **Not persisted** across sessions
- Drained **before** the spine advances on **Next**
- Visible as its own section in the queue sheet
- Supports duplicate tracks (identified by position)

#### 3. **Hydration (Lazy Full-Track Load)**

Full playback payloads (`FullTrack`: audioFiles, coverImage, duration) are fetched on demand:

- **When**: Before playing a track and for a small **lookahead** (current + next four tracks)
- **API**: `GET /api/tracks/playback?ids=…` (batch, max ~20 IDs)
- **Cache**: In-memory `PlaybackHydrationCache` in the provider; stubs (`duration: null`, empty `audioFiles`) until hydrated
- **UI**: Queue sheet and player show title/artist immediately; cover and duration fill in as hydration completes

This replaces the previous paginated `fields=full` fetch of every track on play.

#### 4. **Queue Loading & Navigation**

**On play (warm start)**:

1. Selected track begins playing immediately (using already-known or stub data)
2. Spine loads in the background (single request)
3. Provider hydrates current track + lookahead
4. An epoch guard cancels stale spine fetches if the user switches context mid-load

**Playback order on Next**:

1. Drain **Up Next** front (FIFO among **Play next** inserts)
2. Advance **spine pointer** (linear index or shuffled order)
3. **Loop all** wraps to the start of the spine; **loop one** replays current

**Previous** walks backward through spine play order (not into Up Next).

**Virtual Scrolling** (queue sheet):

- **Up Next**: virtual list when 20+ items
- **From Library / From Playlist**: always virtualized for large spines
- Only visible tracks are rendered in the DOM

#### 5. **Queue Actions (Cold vs Warm)**

Three per-track and bulk actions. Behavior depends on whether the player is already active (**warm**) or nothing is playing (**cold**):

| Action             | Warm (player active)                                                                             | Cold (nothing playing)                                           |
| ------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Play next**      | Insert at **front** of Up Next (FIFO among play-next items); does not interrupt current playback | Cue track as **current (paused)**; open player; **no auto-play** |
| **Add to up next** | Append to **end** of Up Next                                                                     | Queue in Up Next; open player; **no auto-play**                  |
| **Add to queue**   | Append to **true end** (after entire spine)                                                      | Queue at true end; open player; **no auto-play**                 |

- All three actions appear on library and user-playlist track row menus (playable tracks only)
- Bulk playlist UI exposes all three; default / primary for "add whole playlist" is **Add to up next**
- Success toasts confirm the action; menu clicks do not trigger row click-to-play

#### 6. **Queue Management**

**View Queue**:

- Click the queue button (list icon) in the audio player
- Opens a bottom sheet with three sections (see [Queue Sheet UI](#queue-sheet-ui))
- Title summarizes counts, e.g. `Queue (2 up next · 14,832 from library)`
- Highlights the current track in the **Now playing** section

**Remove Tracks**:

- Each track in Up Next and the spine has a remove button
- Supports duplicate tracks (same track can appear multiple times)
- If the current track is removed, automatically plays the next available track

**Track Identification**:

- Tracks are identified by both ID and position within their zone
- Ensures accurate removal and navigation with duplicates

#### 7. **Queue Navigation**

**Next Track**:

- Drains Up Next first, then advances the spine
- Respects loop and shuffle modes
- If at end of spine:
  - Loop Off: Stops playback
  - Loop All: Wraps to first spine track
  - Loop One: Replays current track

**Previous Track**:

- Goes back one step in spine play order
- Respects loop modes
- If at beginning of spine:
  - Loop Off: Does nothing
  - Loop All: Wraps to last spine track
  - Loop One: Replays current track

**Shuffle Mode**:

- Builds a Fisher-Yates permutation of spine indices when enabled
- Next/previous walk the shuffled index list; hydrate full track before play
- Toggling shuffle **on** mid-playback reshuffles from the current position onward; Up Next is untouched
- Toggling shuffle **off** restores linear spine order while keeping the current track

**Loop Modes**:

- **Loop Off**: Normal sequential playback, stops at end
- **Loop All**: Continuous playback, wraps spine when reaching end
- **Loop One**: Repeats current track indefinitely

---

## User Flows

### Flow 1: Playing from Library

1. User browses their music library
2. User clicks "Play" on any track
3. **System Behavior**:
   - Audio player appears at bottom
   - Selected track begins playing immediately
   - Spine resets (if previously had different context)
   - Library spine loads in one request (`GET /api/queue-spine`)
   - Current track + lookahead hydrate via `GET /api/tracks/playback`
4. User can:
   - Navigate through the library using next/previous (Up Next drained first)
   - Open queue sheet to see Now playing, Up Next, and From Library sections
   - Remove tracks from Up Next or upcoming spine
   - Use shuffle/loop modes
   - **Play next**, **Add to up next**, or **Add to queue** from track menus

### Flow 2: Playing from Playlist

1. User opens a playlist
2. User clicks "Play" on any track in the playlist
3. **System Behavior**:
   - Audio player appears at bottom
   - Selected track begins playing immediately
   - Spine resets (if previously had different context)
   - Playlist spine loads in one request
   - Hydration runs for current + lookahead
4. User can:
   - Navigate through the playlist using next/previous
   - Open queue sheet (sections: Now playing, Up Next, From Playlist)
   - Remove tracks, use shuffle/loop modes
   - Bulk-add the playlist via Play next / Add to up next / Add to queue

### Flow 3: Switching Contexts

1. User is playing from library (spine has library tracks)
2. User opens a playlist and clicks "Play"
3. **System Behavior**:
   - Queue state resets (Up Next cleared, spine replaced)
   - New track begins playing immediately
   - New playlist spine loads in the background

### Flow 4: Cold Queue Action (Nothing Playing)

1. User opens library or playlist without active playback
2. User chooses **Add to up next** (or **Play next** / **Add to queue**) from a track menu
3. **System Behavior**:
   - Player opens
   - Track is queued in Up Next or at spine end (or cued as current for **Play next**)
   - **No auto-play** — user presses play when ready

### Flow 5: Warm Queue Action (Player Active)

1. User is listening to track A
2. User chooses **Play next** on track B from a track menu
3. **System Behavior**:
   - Track B inserts at the front of Up Next
   - Track A continues playing uninterrupted
   - On **Next**, track B plays before the spine resumes

### Flow 6: Queue Management

1. User has queue sheet open
2. User scrolls through Up Next or From Library / From Playlist (virtual scrolling)
3. User clicks remove on a track
4. **System Behavior**:
   - Track is removed from its zone
   - If removed track was current: automatically plays next track
   - If removed track was before current spine position: pointer adjusts
   - Queue updates immediately

---

## Visual Design & User Experience

### Audio Player UI

**Layout** (Left to Right):

1. **Left Section**: Track thumbnail + title/artist
2. **Center Section**: Playback controls + progress bar
3. **Right Section**: Queue button + loop + shuffle + download + close

**Visual States**:

- **Loop Button**:
  - Off: Muted gray, hover effect
  - All: Primary color with background highlight
  - One: Primary color with background highlight + "1" badge
- **Shuffle Button**:
  - Off: Muted gray, hover effect
  - On: Primary color with background highlight
- **Play/Pause Button**:
  - Large, prominent, always visible
  - Icon changes based on playback state

### PlayerNowPlayingSheet UI (Mobile)

On mobile, the expanded now-playing view is a full-screen bottom sheet (`PlayerNowPlayingSheet`, in `app/routes/audio-player.tsx`). It shares the same top/center layout as the desktop bar but replaces the single action row with a two-tier action system:

**Bottom Action Row** (5 buttons):

- **Loop** (3-state cycle: Off → All → One)
- **Shuffle** (toggle)
- **Add to Playlist** — opens `AddToPlaylistMenu`. The menu self-fetches the user's playlists from `GET /resources/playlists` when opened (no playlist data passed through the player component tree). Supports inline creation of a new playlist via `POST /resources/create-playlist-with-track` and adding to an existing playlist via `POST /resources/add-track-to-playlist`.
- **Sleep Timer** — sets a timer to stop playback
- **…** (overflow) — opens a secondary bottom sheet

**Overflow Sheet** (opened by the "…" button):

- **Download** — triggers browser download of the current track via `/resources/audio/:trackId?stream=1`
- **Play Next** — inserts at the front of Up Next (does not interrupt current playback)
- **Add to Up Next** — appends to the end of Up Next
- **Add to Queue** — appends to the true end of the queue (after the spine)
- **Track Details** — opens a `TrackDetailsDialog` modal. Track metadata (service name, source URL, added date, duration, genre, album) is fetched on-demand from `GET /resources/track-details?trackId=...` when the dialog opens. The `FullTrack` data model is not enriched — the dialog fetches its own data so the player stays lightweight.

The desktop bar is **unchanged** — it continues to use the existing one-row layout with `TrackListItem` dropdown menus for playlist and queue actions.

### Queue Sheet UI

The queue opens as a bottom sheet (80% viewport height) with **three sections**:

1. **Now playing** — highlighted current track with remove action
2. **Up Next** — manual zone; plain list below 20 items, virtual list at 20+
3. **From Library** or **From Playlist** — upcoming spine tracks (virtual list); heading depends on play context

**Header title** summarizes zone counts, e.g.:

- `Queue (2 up next · 14,832 from library)`
- `Queue (500 from playlist)` when Up Next is empty

**Track Items** (all sections):

- Thumbnail (or placeholder icon; fills in after hydration)
- Title and artist (available immediately from spine)
- Remove button (trash icon)
- Current track in **Now playing**:
  - Background color highlight
  - Left border accent
  - Play icon badge on thumbnail

**Empty state**: "Queue is Empty" when no current track, Up Next, or spine.

**Performance**:

- Spine section virtualizes regardless of size
- Up Next virtualizes at 20+ items
- Smooth scrolling through thousands of spine tracks

---

## Technical Performance Features

### 1. **Spine + hydration (replaces paginated full fetch)**

- **Spine**: one `GET /api/queue-spine` response with minimal `QueueTrack[]` — no pagination
- **Hydration**: batch `GET /api/tracks/playback` for current + four-track lookahead
- Playlist/library fetch uses an epoch guard so stale responses are ignored after context switches
- See [ADR-015](./decisions/015-queue-spine-architecture.md) and `docs/specs/queue-spine-system.md`

### 2. **Presigned URL playback**

- Audio `src` is set only after the server returns the stream URL for the current track
- Prevents auto-play from firing on a previous track's URL during fast navigation (React `useEffect` cleanup / ignore-flag pattern)

### 3. **Virtual Scrolling**

- Spine section always virtualized; Up Next virtualizes at 20+ items
- Renders only visible items
- Handles unlimited spine counts
- Minimal DOM footprint

---

## Offline playback (PWA)

When the user has no network (`navigator.onLine === false`) or loader fetches fail, the player and queue use **device-local storage** (`app/features/offline-storage/`) instead of presigned Tigris URLs.

### Playback source selection

1. **Online** — `playTrack` / `playLibrary` / `playUserPlaylist` fetch playable tracks from the server, then set `src` from `/resources/audio/:trackId` (presigned stream).
2. **Offline** — Same entry points call `fetchOfflineTracks` / `listPinned()` and build blob URLs from OPFS bytes. Correct MIME types come from stored `audioFormat` metadata.

`createOfflineClientLoader` / `loadWithOfflineFallback` (`app/features/offline-app/offline-loader.client.ts`) handles route data the same way: check offline first, then catch network errors.

### Queue auto-cache

While online and the player is visible, the provider caches the **current track and the next three** queue tracks via `storage.cacheQueueTrack()`. These are queue-cached (LRU-eligible), not pinned. Failures are logged and do not block playback.

### Download button

The player and track pages trigger downloads through `triggerBrowserDownload()` (`app/utils/download.ts`):

- Fetches same-origin `/resources/audio/:trackId?stream=1` as a blob
- Desktop/Android: programmatic `<a download>` click
- iOS: `navigator.share({ files })` when supported

Pinned downloads persist until removed; they appear in `/downloads` and offline `/library`. Queue-cached-only tracks appear on `/downloads` but not in offline `/library`.

### Error UX

When offline playback fails (missing file, corrupt blob), the audio player shows an error bar with a short message instead of failing silently.

See [ADR-013](./decisions/013-pwa.md) and `docs/CONTEXT.md` (decisions #42–#57) for storage policy and route scope.

---

## Edge Cases & Special Behaviors

### Duplicate Tracks

- Same track can appear multiple times in queue
- Each instance is tracked by position
- Removal affects only the specific instance
- Navigation works correctly with duplicates

### Empty Queue

- Shows empty state message
- Disables navigation buttons
- Prevents playback errors

### Track Without Audio Files

- Player doesn't appear if no audio available
- Graceful handling of missing files
- User sees appropriate feedback

### Browser Autoplay Restrictions

- Respects browser autoplay policies (`play()` returns a Promise; may reject with `NotAllowedError`)
- Requires user interaction for initial play in many browsers
- Handles autoplay prevention gracefully (play button remains available)
- Play button works immediately after user interaction

### Large Library Performance

- Designed for 5,000–15,000+ track libraries
- Playback starts after one spine request + a small hydration batch (not N paginated full-track pages)
- Queue sheet scrolls smoothly via virtual lists
- No performance degradation from loading full `audioFiles` for every library track up front

---

## User Benefits

1. **Seamless Experience**: Play from anywhere; spine manages context automatically
2. **Fast start**: Playback begins on the selected track while the spine loads in one request
3. **Manual control**: Three queue actions (Play next, Add to up next, Add to queue) with clear cold/warm behavior
4. **Visual Clarity**: Three-zone queue sheet; clear indicators for current track, loop/shuffle states
5. **Scales to large libraries**: Spine + hydration avoids loading full payloads for tracks you never reach
6. **Flexible Playback**: Fisher-Yates shuffle with reshuffle-on-toggle, multiple loop modes, easy track removal

---

## Future Enhancement Opportunities

1. **Queue Persistence**: Save queue state (including Up Next) across sessions
2. **Spine Reordering**: Drag-and-drop to reorder spine tracks
3. **Queue History**: View recently played tracks
4. **Smart Queue**: AI-suggested next tracks
5. **Queue Sharing**: Share queue with other users
6. **Queue Export**: Export queue as playlist
7. **Cross-Device Sync**: Continue playback on different devices

---

## Summary

The audio player and queue system provide a modern, efficient music playback experience built on a **three-zone model** (Now playing → Up Next → Spine). A lightweight spine fetch plus lazy hydration keeps playback fast even for libraries with tens of thousands of tracks, while Up Next gives users explicit control over what plays next. The queue sheet surfaces all three zones clearly, and Fisher-Yates shuffle with reshuffle-on-toggle preserves predictable navigation. See `docs/CONTEXT.md` (glossary) and [ADR-015](./decisions/015-queue-spine-architecture.md) for architecture details.
