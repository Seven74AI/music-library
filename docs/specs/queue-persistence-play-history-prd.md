# PRD: Cross-Device Queue Persistence & Play History

> Source: ADR-017 (`docs/decisions/017-cross-device-queue-persistence-play-history.md`)

## Problem Statement

The player keeps its entire state in memory, so the queue, current track, shuffle order, and manual "Up Next" additions vanish the moment the user reloads the page or opens the app on another browser or device. There is also no way to see what the user recently played — the home page's "recent tracks" actually shows tracks recently _added_ to the library, not recently _played_.

## Solution

1. **Persist the queue per user on the server.** Save enough to reconstruct the queue on a fresh load (the play context, current track, Up Next additions, shuffle state, and loop mode). On open, restore the queue and current track — paused, ready to resume with one tap. Reconstruct the spine from the play context rather than snapshotting the whole track list, so the restored queue always reflects the current contents of the user's library/playlist.
2. **Add a play-history page.** A read-only `/history` page listing the user's recently played tracks (most recent first), with a completed/not-completed indicator, cursor pagination with infinite scroll.

## User Stories

1. As a listener, I want my queue to persist across page reloads, so that I don't lose my place when I refresh.
2. As a listener, I want my queue to persist across devices, so that opening the app on a second browser resumes the same queue.
3. As a listener, I want my current track to be restored, so that I can continue from the song I was listening to.
4. As a listener, I want my current track to restart from the beginning on restore, so that I'm not dropped mid-song.
5. As a listener, I want the player to restore in a paused state, so that I can choose when playback starts (and two devices don't "play" simultaneously).
6. As a listener, I want my manual "Play next" / "Add to up next" additions to persist, so that my curated ordering survives a reload.
7. As a listener, I want my shuffle state (on/off and order) to persist, so that my shuffled queue is the same when I return.
8. As a listener, I want my loop mode to persist, so that repeat behavior is consistent across sessions.
9. As a listener, I want my queue to survive logout and login, so that signing out on one device does not wipe my queue.
10. As a listener, I want my restored queue to reflect the current contents of my library/playlist, so that tracks removed since my last session don't reappear.
11. As a listener, I want partial restore when offline (current track and Up Next, if downloaded), so that I can keep listening without a network connection.
12. As a listener, I want to see a list of my recently played tracks, so that I can find something I listened to earlier.
13. As a listener, I want the most recently played track at the top of my history, so that I can see the last song I played immediately.
14. As a listener, I want to see whether I completed a track or skipped it, so that I can distinguish finished listens from interrupted ones.
15. As a listener, I want to scroll back through a long history (infinite scroll), so that I can page through my listening past without loading everything at once.
16. As a listener, I want repeated plays of the same track to appear as separate entries, so that the history reflects what actually happened.
17. As a listener, I want deleted/unavailable tracks omitted from my history, so that the list only shows identifiable, playable tracks.
18. As a listener, I want to play a track directly from my history, so that I can replay something I enjoyed.

## Implementation Decisions

### Feature 1 — Cross-device queue persistence

- **Persist queue + current track, not intra-track position.** The current track restarts at 0:00 on restore. Mid-song `currentTime` resume is out of scope (goes stale across device switches and risks two live players).
- **Re-derive the spine; persist only ephemeral state.** Store the play context, current track ID, Up Next track IDs, shuffle seed, and loop mode. On restore, fetch the spine from the play context and replay position/order/up-next on top. Do not snapshot the resolved track list — a snapshot would resurrect tracks removed from the playlist/library since the last session, and would cost ~420KB per write at 15k-track library scale.
- **New `PlayerState` model, one row per user** (unique `userId`), with: `playContext` (JSON: `{ type, playlistId?, artistId?, albumId?, trackId? }`), `currentTrackId` (nullable string), `upNextIds` (JSON string array), `shuffleSeed` (nullable int — `null` = shuffle off), `loopMode` (string), `updatedAt`.
- **Seeded shuffle.** Replace the client Fisher-Yates shuffle's `Math.random()` with a seeded PRNG. Generate a 32-bit seed when shuffle is toggled on or reshuffled, store it, and regenerate the identical permutation on restore. The current track is the position anchor (resolved by finding its position in the reconstructed play order), not a raw index. Accepted tradeoff: a seed is positional — if the spine length changes between sessions, the same seed yields a different (but deterministic) order.
- **Restore-and-wait.** On load, restore the queue → set current track → show the player → paused. No `play()` call (autoplay is blocked without a gesture anyway, and auto-resume risks two devices playing the same queue).
- **Debounced write + unload flush.** Queue mutations (play/next/previous/up-next add/remove/shuffle/loop toggle/auto-advance) update in-memory state immediately; the DB write is debounced ~1s after the last change, plus a flush on page unload (sendBeacon or `fetch` with `keepalive`). Every `currentTrack` change counts as a mutation.
- **Offline partial restore.** With no network, restore `currentTrackId` + `upNext` from the local offline cache _if those tracks are downloaded_, and skip the spine re-derivation; backfill the spine on reconnect. Do not cache a client-side spine snapshot (reintroduces drift and a second source of truth).
- **Logout keeps the queue.** `PlayerState` is account state, not session state; no write in the logout path.

### Feature 2 — Play history page

- **Reuse `UsageEvent`; no new table.** History reads `play_started` events joined to `Track`. Add a `[userId, type, createdAt]` index. (A dedicated `PlayHistory` table duplicates ~90% of `UsageEvent` and adds a second write per play.)
- **`playId` correlation ID.** `UsageEvent` gains a nullable `playId`. The client generates `crypto.randomUUID()` when a track starts and sends it on both the `play_started` and `play_completed` events, so "completed" status is exact rather than heuristically paired.
- **Completed status = presence of a `play_completed` with the same `playId`.** `play_completed` remains the ≥50%-progress / `ended` signal.
- **Per-play listing.** Every `play_started` is its own row (repeats appear as separate timestamped entries). Rejected: per-track collapse (a separate "most played" feature).
- **Cursor pagination + infinite scroll.** Key on `(createdAt, id)` (id as tiebreaker), initial page ~50, "load more" pages backward. Stable under new events arriving.
- **Skip dangling track IDs.** The `Track` join filters out rows whose track is gone. Tracks that still exist in the DB but are no longer in the user's library are shown (they still have metadata).
- **Dedicated `/history` route.** Reachable from nav. A home-page "recently played" strip is deferred.

### Schema changes (summary)

- New `PlayerState` model (one row per user).
- `UsageEvent.playId String?` column.
- New index on `UsageEvent`: `[userId, type, createdAt]`.

### API contracts (summary)

- `POST /resources/play-event` — accepts an additional `playId` field; stores it on the event.
- `PUT` + `GET /resources/player-state` — save/load the user's `PlayerState` (one row per user).
- `GET /history` (route loader) — cursor-paginated `play_started` history with completed status.

## Testing Decisions

- **Test external behavior, not implementation details.** Assert on the round-trip of persisted state and the rendered history, not on internal React state shape.
- **Prefer existing seams.** Extend the existing `record-usage.server.test.ts` / `play-event.test.ts` seam for the `playId` field, the `queue-shuffle.test.ts` seam for seeded shuffle, and the `audio-player-provider.test.tsx` seam for restore orchestration.
- **Two new server seams**, tested at the HTTP route boundary against the real SQLite test DB (the repo's established integration-test pattern, per `queue-spine.test.ts`):
  1. Player-state route — save/load round-trip of `PlayerState`; debounce logic.
  2. History loader — `play_started` listing, cursor pagination, completed badge via `playId`, dangling-ID skip.
- **Seeded shuffle tests:** same seed + same length ⇒ identical permutation; different length ⇒ deterministic but different; null seed ⇒ shuffle off.
- **Restore tests:** restore-and-wait (no autoplay), current-track restart, offline partial restore.
- **Prior art:** `app/features/usage-analytics/play-event.test.ts`, `record-usage.server.test.ts`; `app/features/queue/queue-shuffle.test.ts`, `queue-spine.test.ts`; `app/components/audio-player-provider.test.tsx`.

## Out of Scope

- Intra-track `currentTime` resume.
- Client-side spine snapshot cache for offline restore.
- Per-track collapse of history (a "most played" view).
- A dedicated `PlayHistory` table.
- Backfilling completed status for plays recorded before `playId` exists.
- A home-page "recently played" strip (deferred).

## Further Notes

- Full rationale and alternatives are in ADR-017.
- `UsageEvent` grows unbounded (ADR-016); the history read must use cursor pagination from the start.
- The seeded-shuffle change touches a core client module (`queue-shuffle`); its tests must be updated in the same PR.
