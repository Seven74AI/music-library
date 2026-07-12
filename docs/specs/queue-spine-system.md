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

## References

- Existing type: `QueueTrack` in `app/types/frontend/shared.ts`
- Current provider: `app/components/audio-player-provider.tsx` (`fetchAllTracks`)
- Product doc to update: `docs/AUDIO_PLAYER_AND_QUEUE.md`
