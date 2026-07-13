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

## Edge Cases

This section documents the known edge cases in the queue navigation and mutation operations, derived from the implementation in `app/features/queue/queue-navigation.ts` and `app/components/audio-player-provider.tsx`.

### Null returns from `resolveNextTrack`

`resolveNextTrack` returns `null` when no track can be resolved in the forward direction. The callers must handle `null` gracefully (e.g., by disabling the "Next" button or letting playback stop).

| Condition | Up Next | Spine state | Loop mode | Result |
|---|---|---|---|---|
| Empty queue | Empty | `spineOrder.length === 0` | Any | `null` |
| End of spine with loop off | Empty | `spinePosition` is last in `spineOrder` | `off` | `null` |
| End of spine with loop-all but empty spine | Empty | `spineOrder.length === 0` | `all` | `null` |

**Note:** `loopMode === 'one'` always returns the current spine position and never produces `null` from `resolveNextTrack`. Loop-one takes priority over both Up Next draining (checked first) and all other spine logic.

**Caller contract:** The `audio-player-provider` calls `resolveNextTrack` in `playNext` (line 710), `removeCurrentFromQueue` fallback (line 594), and the queue-sheet-driven `advanceToTarget` path. Every caller checks for `null` before proceeding — `playNext` returns early, `advanceToTarget` is guarded by `hasNextTrack`.

### Null returns from `resolvePreviousTrack`

`resolvePreviousTrack` returns `null` when no track can be resolved in the backward direction.

| Condition | Spine state | Loop mode | Result |
|---|---|---|---|
| Empty queue | `spineOrder.length === 0` | Any | `null` |
| Start of spine with loop off | `spinePosition === 0` | `off` | `null` |
| Start of spine with loop-all but empty spine | `spinePosition === 0`, `spineOrder.length === 0` | `all` | `null` |

**Note:** Unlike `resolveNextTrack`, `resolvePreviousTrack` does NOT consider the Up Next zone. Previous navigation only walks backward through the spine play order. If the user wants to go back to a track that just played from Up Next, they cannot — Up Next items are drained (removed) on play via `advanceAfterPlay`.

**Note:** `loopMode === 'one'` always returns the current spine position and never produces `null` from `resolvePreviousTrack`.

### Index-based duplicate removal

The spine can contain the same track ID at multiple positions. `addTrackToPlaylist(position='end')` does not deduplicate — it appends to the `spine` array and `spineOrder` without checking for existing entries. This means the same track can appear multiple times in the queue.

Key behaviors when duplicates exist:

| Operation | Behavior |
|---|---|
| `removeTrackFromPlaylist(spine, orderIndex)` | Removes the track at the given `spineOrder` index only. If the same track ID appears at multiple spine indices, only the targeted occurrence is removed. The other occurrences remain and their `spineOrder` indices are adjusted (decremented if they were positioned after the removal). |
| `findSpinePositionForTrackId(trackId)` | Returns the **first** position in `spineOrder` whose spine index maps to the given track ID. Uses `Array.findIndex`. If the same track ID appears multiple times, only the earliest occurrence is found. |
| `removeCurrentFromQueue()` | Uses `findSpinePositionForTrackId` to locate the current track. If duplicates exist, it removes only the first occurrence. |

**Implication:** When a track appears multiple times in the spine and the user removes "the current track," only the first occurrence is removed. The duplicate further ahead in the queue remains. Callers iterating removal until no occurrences remain must loop — a single `removeCurrentFromQueue` call is not sufficient.

### Spine pointer validity after mutation

The `spinePosition` is an index into `spineOrder` (not the raw `spine` array). Mutation operations update `spine`, `spineOrder`, and `spinePosition` atomically via React state setters, but the validity guarantees differ by operation.

#### `addTrackToPlaylist(position='end')`

Appends a track to the end of both `spine` and `spineOrder`. `spinePosition` is **not adjusted**. The pointer remains valid — it still references the same position in `spineOrder`, which maps to the same raw spine index (provided no concurrent reordering has shifted indices). Since the append only adds at the end, existing indices are unchanged.

#### `addTrackToPlaylist(position='next' | 'upNext')`

Only modifies `upNext`. Neither `spine`, `spineOrder`, nor `spinePosition` are touched. Pointer remains fully valid.

#### `removeTrackFromPlaylist(zone='spine')`

Three cases based on the removed track's position relative to `spinePosition`:

| Relationship | Effect on `spinePosition` | Pointer validity |
|---|---|---|
| `orderIndex < spinePosition` | Decremented by 1 to compensate for the shift | Still correct — points to the same logical track after the gap closes |
| `orderIndex === spinePosition` | Current track is being removed. Advances to the next track via `advanceAfterPlay` and plays it (or clears `currentTrack` if no next track exists) | N/A — the current track is gone; playback moves forward |
| `orderIndex > spinePosition` | Unchanged | Still correct — the removed track was ahead in the queue, current position is unaffected |

After a spine removal, `spineOrder` is filtered and remaining indices are re-mapped: any spine index greater than the removed index is decremented by 1. This keeps the `spineOrder → spine` mapping valid.

#### `removeTrackFromPlaylist(zone='upNext')`

Only modifies `upNext` and optionally `upNextPlayNextCount`. Does NOT touch `spine`, `spineOrder`, or `spinePosition`. Pointer remains fully valid.

#### `toggleShuffle` (on)

Calls `reshuffleFromCurrent(spineOrder, spinePosition)`. The prefix (indices 0 to `spinePosition - 1`, already played) is preserved; the suffix (from `spinePosition` onward) is Fisher-Yates shuffled. `spinePosition` is **not changed** — it still points to the same position in the partially-reshuffled `spineOrder`. The current track's position is preserved; only upcoming tracks are reordered.

#### `toggleShuffle` (off)

Replaces `spineOrder` with an identity-order array `[0, 1, 2, ...]` and adjusts `spinePosition` to match the raw spine index of the current track. This correctly re-maps the pointer from shuffled-order-space to identity-order-space.

#### Full queue reset (`playTrack`, `playLibrary`, `playUserPlaylist`, `playPlaylist`)

These operations set entirely new `spine`, `spineOrder`, and `spinePosition` values. The old state is discarded. No pointer validity concern — this is a fresh queue, not a mutation of an existing one.

#### Edge case: `spineOrder` and `spine` length mismatch

`spineOrder` is always a permutation of indices into `spine`. After the initial spine load and after every mutation, the two arrays are kept consistent:
- `spineOrder[i]` is always a valid index into `spine` (0 ≤ value < spine.length)
- `spineOrder.length === spine.length` always holds

There is no code path that produces a length mismatch. A `spineOrder` index pointing past the end of `spine` would be a bug, not an expected edge case.

## References

- Existing type: `QueueTrack` in `app/types/frontend/shared.ts`
- Current provider: `app/components/audio-player-provider.tsx` (`fetchAllTracks`)
- Product doc to update: `docs/AUDIO_PLAYER_AND_QUEUE.md`
