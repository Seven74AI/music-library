# ADR-017: Cross-Device Queue Persistence and Play History

## Status

Accepted — proposed. Decisions below are locked and complete.

## Context

Two product gaps:

1. **Player state is 100% in-memory.** `AudioPlayerProvider` holds the queue (`currentTrack`, `upNext`, `spine`, `spineOrder`, `spinePosition`, `loopMode`, `isShuffleEnabled`) plus an in-memory `PlaybackHydrationCache` (Map of trackId → `FullTrack`). Nothing survives a reload or a second browser. `localStorage` is only used for volume, autoplay-guide flags, recent searches, and offline metadata — never the queue.
2. **There is no "recently played" view.** `UsageEvent` already records every `play_started` / `play_completed` (with `userId`, `trackId`, `createdAt`), but nothing surfaces it. Home's "recent tracks" are tracks recently _added_, not _played_.

The queue is re-derivable from a **spine** (ADR-015): a deterministic track list for a context (`library` / `playlist` / `artist` / `album` / `track`), fetched from `/api/queue-spine`, with a client-side shuffle permutation applied. Library spines can reach 15k+ tracks.

## Decision

### Feature 1 — Cross-device queue persistence

**Scope (persist queue + current track, NOT intra-track position).** We persist the resolved queue and current track ID; the current track restarts at 0:00 on restore. Mid-song `currentTime` is explicitly out of scope — it goes stale across device switches and would create two live players.

**Storage model — re-derive the spine, persist only the ephemeral bits.** We do not snapshot the resolved track list. We store the _recipe_ and reconstruct the spine fresh on restore:

```prisma
model PlayerState {
  id             String   @id @default(cuid())
  userId         String   @unique
  playContext    Json     // { type, playlistId?, artistId?, albumId?, trackId? }
  currentTrackId String?
  upNextIds      Json     // string[] — manual "play next" additions (small)
  shuffleSeed    Int?     // null = shuffle off
  loopMode       String   @default("off")
  updatedAt      DateTime @updatedAt
}
```

Re-derive is preferred over snapshot because (a) the spine is the canonical "what's in this playlist/library right now" — a snapshot would resurrect tracks removed since the last session (a bug); (b) storage cost: a 15k-track `shuffleIds` list is ~420KB written on every mutation, vs. a single `shuffleSeed` integer.

**Shuffle — seeded PRNG.** The client Fisher-Yates shuffle (ADR-015) currently uses `Math.random()` (no seed). Switch to a seeded PRNG: generate a 32-bit seed when shuffle is toggled on / reshuffled, store it, and regenerate the _identical_ permutation on restore. `currentTrackId` is the position anchor (resolved via `findSpinePositionForTrackId`), not a raw index.

- **Accepted tradeoff:** a seed is _positional_. If the spine length changes between sessions (track added/removed), the same seed yields a different (but deterministic) order — we lose "preserve exact order across edits." For a 15k library this is imperceptible (it's a random permutation of 15k songs); for small playlists a seeded shuffle reproduces the exact order as long as the playlist didn't change.

**Restore behavior — restore-and-wait (paused).** On load, restore queue → set `currentTrack` → show player → **paused**. No `play()` call: browser autoplay policies block it anyway, and auto-resume risks two devices "playing" the same queue.

**Write cadence — debounced + unload flush.** Queue mutations (play/next/previous/up-next add-remove/shuffle/loop/auto-advance) update in-memory state immediately; the DB write is debounced ~1s after the last change, plus a flush on page unload (`navigator.sendBeacon` or `fetch` with `keepalive`). Every `currentTrack` change counts as a mutation (the current track ID is the thing we save).

**Offline — partial restore.** If there is no network: restore `currentTrackId` + `upNext` from the local IndexedDB cache _if those tracks are downloaded_, but skip the spine re-derivation. On reconnect, backfill the spine. (Deliberately does **not** cache a client-side spine snapshot — that reintroduces the drift/size problem and a second source of truth.)

### Feature 2 — Play history page

**Data source — reuse `UsageEvent`, no new table.** Query `play_started` events for the user, `LEFT JOIN` to `Track`, render recent-first. Add a `[userId, type, createdAt]` index. A dedicated `PlayHistory` table is rejected: it duplicates ~90% of what `UsageEvent` already holds and adds a second write per play.

- `UsageEvent.trackId` has **no FK** — deleted tracks become dangling IDs; the query must `LEFT JOIN` and skip/filter null tracks.
- History uses **`play_started`** as "you played this." `play_completed` (the ≥50% heuristic) is not a separate history entry.

**Completed status — correlation ID.** To mark a play as completed on the history row, the client generates a `playId` (`crypto.randomUUID()`) when a track starts and sends it on _both_ the `play_started` and `play_completed` events. `UsageEvent` gains a nullable `playId` column. This is exact (no heuristic pairing) and future-proof.

- **Performance:** no issue. A full play already writes two `UsageEvent` rows; `playId` is one more string column on those same rows — write count unchanged. The history read uses the existing `[userId, createdAt]` index; the completed lookup is a second cheap `WHERE userId = ? AND type = 'play_completed'` query on the same index. No `playId` index needed for v1 (nothing queries _by_ playId). Client cost is `crypto.randomUUID()` held in a ref.

**List semantics — per-play.** Every `play_started` is its own row (repeats appear as separate timestamped entries), matching "see the last played song" literally. Rejected: per-track collapse (grouping/aggregation, arguably a separate "most played" feature).

**Pagination — cursor pagination + infinite scroll.** Keyed on `(createdAt, id)` (id as tiebreaker — `UsageEvent.id` is a cuid), initial page ~50, "load more" pages backward. Reuses the cursor-pagination pattern already used by FTS5 search. Required because `UsageEvent` grows unbounded (ADR-016 deferred retention), so paging must be stable under new events arriving. The "completed" `playId` lookup runs per-page alongside the started rows (not one global query).

**Route — dedicated `/history` page (v1).** A first-class page reachable from nav. A home-page "Recently played" strip is deferred (home already has a confusingly-named "recent tracks" = recently _added_; adding a second "recent" strip risks muddling that UX).

**Deleted tracks — skip dangling IDs.** The `LEFT JOIN` filters out rows whose `Track` is gone (no title/artist to show, unplayable). Tracks that still exist in the DB but are no longer in the user's library **are shown** (they have metadata; hiding them would need an extra access check).

### `PlayerState` lifecycle

**Logout keeps the saved queue.** `PlayerState` is account state, not session state — it survives logout, cookie expiry, and device changes. No write in the logout path.

## Consequences

- New `PlayerState` table (one row per user) + a `playId` column on `UsageEvent` — one migration.
- `queue-shuffle.ts` moves from `Math.random()` to a seeded PRNG (change to a core module, with test updates).
- `reportPlayEvent(type, trackId, playId)` signature change; `play-event.tsx` parses/stores `playId`; `recordUsageEvent` accepts it.
- Restore-on-load touches `AudioPlayerProvider` mount path; offline restore integrates with the existing offline-storage layer.
- History page is a new read-only route; no backfill of pre-existing plays (they lack `playId`, so completed status will be unknown for old rows).

## Non-goals

- Intra-track `currentTime` resume (goes stale across device switches; risks two live players).
- Client-side spine snapshot cache for offline restore (reintroduces drift/size problem + second source of truth).
- Per-track collapse on history (separate "most played" feature).
- Dedicated `PlayHistory` table (duplicates `UsageEvent`; adds a second write per play).
