# Queue Spine System — Spec

Scalable queue architecture for large personal libraries (5k–15k+ tracks). Replaces the current `fields=full` paginated fetch of every track on play.

**Status:** Approved via `/grill-with-docs` (Jul 2026).

## Problem

When a user plays a track from their library, `audio-player-provider` paginates through **all** playable tracks via `/api/user-tracks?fields=full&hasAudio=1` (100 per page). At 5k tracks that is ~50 round-trips and ~50 full Prisma joins (artist, cover, service, **audioFiles** per row). The same pattern applies to playlist context.

## Solution overview

Split the queue into three zones and load data in two tiers:

```
[ Now playing ] → [ Up Next (manual) ] → [ From Library / playlist (spine) ]
```

| Tier | Data | When loaded |
|------|------|-------------|
| **Spine** | `QueueTrack[]` — id, title, artist | One request on play |
| **Hydration cache** | `Map<id, FullTrack>` — audioFiles, cover, duration | On demand: current + lookahead (4 tracks) |
| **Up Next** | `QueueTrack[]` — user-injected manual zone | In memory only |

## Playback order

On **Next**:

1. Drain **Up Next** front (FIFO among Play-next inserts).
2. Advance **spine pointer** (linear index or Fisher-Yates shuffled order).
3. **Loop all** wraps spine; **loop one** replays current.

## Navigation

The navigation state machine lives in `app/features/queue/queue-navigation.ts`. It is a pure functional layer — every function takes a `QueueNavigationState` and returns a new value without side effects.

### State type: `QueueNavigationState`

```ts
type QueueNavigationState = {
  upNext: QueueTrack[]       // manual injection zone
  spine: QueueTrack[]        // full play context (library/playlist)
  spineOrder: number[]       // permutation of spine indices (linear or shuffled)
  spinePosition: number      // current position within spineOrder
  loopMode: LoopMode         // 'off' | 'all' | 'one'
}
```

### `resolveNextTrack(state) → QueueTarget | null`

Determines the next track to play after the current one finishes. Rules, applied in order:

1. **Drain Up Next** — if `upNext` is non-empty, return front (`{ zone: 'upNext', index: 0 }`).
2. **Loop one** — if `loopMode === 'one'`, return the current spine position.
3. **Advance spine** — if `spinePosition + 1` is within `spineOrder`, return the next spine position.
4. **Loop all** — if `loopMode === 'all'` and spine is non-empty, wrap to `{ zone: 'spine', index: 0 }`.
5. **End** — return `null` (no more tracks).

Up Next is unaffected by loop mode — it always drains first, then the spine takes over.

### `resolvePreviousTrack(state) → QueueTarget | null`

Determines the previous track. Does **not** look at Up Next — only moves backward through the spine:

1. **Loop one** — if `loopMode === 'one'`, return the current spine position.
2. **Move back** — if `spinePosition - 1 >= 0`, return the previous spine position.
3. **Loop all** — if `loopMode === 'all'` and spine is non-empty, wrap to the last position in `spineOrder`.
4. **End** — return `null`.

### `advanceAfterPlay(state, played) → QueueNavigationState`

Mutates the queue state after a track has finished playing. The behavior depends on which zone the played track came from:

- **Up Next target** — removes the track from `upNext` by its index. The spine is untouched.
- **Spine target** — updates `spinePosition` to `played.index`. The spine array itself is unchanged (tracks are never removed from the spine).

Returns a **new** `QueueNavigationState` — the original is never mutated. The caller replaces its state reference with the returned value.

### `getTrackAtTarget(state, target) → QueueTrack | null`

Resolves a `QueueTarget` to the actual `QueueTrack`:

- **Up Next** — direct array lookup: `state.upNext[target.index]`.
- **Spine** — indirect lookup: maps through `spineOrder[target.index]` to get the raw spine index, then returns `state.spine[spineIndex]`.

Returns `null` if the target index is out of bounds.

### `findSpinePositionForTrackId(state, trackId) → number | null`

Finds the spine position (index into `spineOrder`) for a given track ID. Searches linearly through `spineOrder` and returns the position where `spine[spineIndex].id === trackId`. Returns `null` if the track is not in the spine.

Used when the user taps a specific track in the queue sheet — the provider uses this to sync the spine pointer so next/previous navigation continues from the tapped position.

### Helper predicates

- **`hasNextTrack(state)`** — `resolveNextTrack(state) !== null`
- **`hasPreviousTrack(state)`** — `resolvePreviousTrack(state) !== null`

### View helpers

- **`getSpinePlayOrder(state)`** — the spine tracks from the current position onward (for queue display when nothing is playing).
- **`getUpcomingSpinePlayOrder(state)`** — the spine tracks from position+1 onward (for queue display when a track is playing, excluding "now playing").
- **`buildFlatQueueView(state)`** — concatenates `upNext` + `getSpinePlayOrder(state)` into a single flat array.
- **`flatIndexForSpinePosition(state, spinePosition)`** — maps a spine position to an index in the flat queue view.
- **`getQueueSpineDisplayTracks(state, hasCurrentTrack)`** — returns upcoming spine tracks (position+1) when a track is playing, or the full spine order when nothing is playing.

## Shuffle (Fisher-Yates)

- When shuffle is **enabled**: build a permuted index array over the spine once (or when toggled on).
- When shuffle is **toggled on mid-playback**: reshuffle spine indices **from current position onward**; Up Next zone is untouched.
- **Next/Prev** walk the shuffled index list; hydrate full track before play.

## Queue actions

### Labels

| Action | Player active | Nothing playing |
|--------|---------------|-----------------|
| **Play next** | Insert at **front** of Up Next (FIFO among Play-next items) | Cue track as **current (paused)**; open player; no auto-play |
| **Add to up next** | Append to **end** of Up Next | Queue in Up Next; open player; no auto-play |
| **Add to queue** | Append to **true end** (after entire spine) | Queue at true end; open player; no auto-play |

### Bulk playlist UI

Expose all three bulk actions. Default / primary for “add whole playlist” is **Add to up next**.

## API

### `GET /api/queue-spine`

Single-response spine fetch (no pagination).

Query params:

- `context=library` | `playlist`
- `playlistId` (required when context=playlist)
- `hasAudio=1` (library only — playable tracks)

Response:

```json
{
  "tracks": [{ "id": "...", "title": "...", "artist": { "id": "...", "name": "..." } }],
  "total": 14832
}
```

Implementation: one Prisma query with minimal `select` (same projection as `fields=minimal` today). Consider response compression (gzip is automatic).

### `GET /api/tracks/playback`

Batch hydration for playback.

Query params:

- `ids` — comma-separated track IDs (max ~20)

Response:

```json
{
  "tracks": [/* FullTrack shape with audioFiles, coverImage, duration */]
}
```

## Client modules

| Module | Responsibility |
|--------|----------------|
| `app/features/queue/queue-spine.ts` | Spine fetch, types |
| `app/features/queue/queue-hydration.ts` | Batch fetch + cache |
| `app/features/queue/queue-shuffle.ts` | Fisher-Yates, reshuffle-from-current |
| `app/features/queue/queue-navigation.ts` | Next/prev resolution across Up Next + spine |
| `audio-player-provider.tsx` | Orchestration; replaces `fetchAllTracks` / flat `FullTrack[]` playlist |

## Queue sheet UI

Three sections in the bottom sheet:

1. **Now playing** (highlighted)
2. **Up Next** — manual zone; virtual list if large
3. **From Library** / **From Playlist** — spine; existing virtual scroll

## Offline

Unchanged fallback: if spine fetch returns empty, use `offline-storage` pinned / playlist lists. Hydration uses cached OPFS paths when available.

## Non-goals (v1)

- Queue persistence across sessions
- Drag-and-drop reorder of spine
- Server-side shuffle (client Fisher-Yates is sufficient)

## References

- Existing type: `QueueTrack` in `app/types/frontend/shared.ts`
- Current provider: `app/components/audio-player-provider.tsx` (`fetchAllTracks`)
- Product doc to update: `docs/AUDIO_PLAYER_AND_QUEUE.md`
