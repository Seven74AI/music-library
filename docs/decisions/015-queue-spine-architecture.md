# ADR-015: Queue Spine and Lazy Hydration

## Status

Accepted — shipped (Jul 2026). See [Implementation status](#implementation-status).

## Context

When a user played from their library or a playlist, the audio player paginated through **all** playable tracks via `/api/user-tracks?fields=full&hasAudio=1` (100 rows per page). At 5k+ tracks that meant ~50 round-trips and ~50 full Prisma joins (artist, cover, service, audioFiles per row) before the queue was usable. The same pattern applied to playlist context.

The product still needs to support large libraries (5k–15k+ tracks) with fast playback start, manual queue injection, shuffle, and a queue sheet that scales.

## Decision

### 1. Three-zone queue model

Split playback order into three zones:

```
[ Now playing ] → [ Up Next (manual) ] → [ Spine (library or playlist) ]
```

- **Spine** — context-ordered playable tracks, fetched once as minimal `QueueTrack[]`.
- **Up Next** — in-memory manual zone; drained before the spine advances.
- **Now playing** — current track; may come from Up Next, spine, or a cold-start cue.

Navigation on **Next**: drain Up Next front → advance spine pointer → **loop all** wraps the spine; **loop one** replays current. See `app/features/queue/queue-navigation.ts`.

### 2. Two-tier data loading

| Tier | Shape | When loaded |
|------|-------|-------------|
| Spine | `QueueTrack[]` (id, title, artist) | One request on play (`GET /api/queue-spine`) |
| Hydration cache | `Map<id, FullTrack>` | On demand: current + four-track lookahead (`GET /api/tracks/playback`) |

The provider (`audio-player-provider.tsx`) orchestrates spine fetch, hydration, and navigation. Client modules live under `app/features/queue/`.

### 3. Client-side Fisher-Yates shuffle

Shuffle permutes spine **play order** (an index array), not the underlying spine list. When shuffle is toggled **on** mid-playback, indices **from the current position onward** are reshuffled; Up Next is untouched. When toggled off, play order reverts to linear spine order while keeping the current track. See `app/features/queue/queue-shuffle.ts`.

### 4. Three queue actions with cold/warm behavior

| Action | Warm (player active) | Cold (nothing playing) |
|--------|----------------------|-------------------------|
| **Play next** | Insert at front of Up Next (FIFO among play-next items) | Cue track as current (paused); open player; no auto-play |
| **Add to up next** | Append to Up Next tail | Queue in Up Next; open player; no auto-play |
| **Add to queue** | Append after entire spine | Queue at true end; open player; no auto-play |

Bulk playlist UI exposes all three actions; default for "add whole playlist" is **Add to up next**.

### 5. Queue sheet: three sections

The bottom sheet shows **Now playing**, **Up Next**, and **From Library** / **From Playlist** (upcoming spine tracks). Title summarizes counts (e.g. `Queue (2 up next · 14,832 from library)`). Large Up Next lists virtualize at 20+ items; the spine section always virtualizes.

### 6. Offline fallback unchanged

If spine fetch fails or returns empty, the provider falls back to device-local pinned / playlist lists from offline storage. Hydration uses cached OPFS paths when available.

## Alternatives Considered

### Keep paginated `fields=full` fetch
**Pros**: Simple mental model; full track data always in memory  
**Cons**: Unacceptable latency and bandwidth at library scale; redundant joins for tracks the user never reaches  
**Decision**: Rejected

### Server-side shuffle
**Pros**: Consistent order across devices  
**Cons**: Extra API/state; client Fisher-Yates is sufficient for v1; queue is not persisted  
**Decision**: Rejected for v1 (see non-goals in `docs/specs/queue-spine-system.md`)

## Consequences

- Playback start is one spine request plus a small hydration batch instead of N paginated full-track pages.
- Queue sheet and navigation operate on lightweight spine rows; covers and durations appear as hydration completes.
- **Add to queue** appends to the spine tail in memory (session-only); it does not mutate the user's library or playlist on the server.
- Product documentation: `docs/AUDIO_PLAYER_AND_QUEUE.md`; glossary terms in `docs/CONTEXT.md`.

## Implementation status

| Area | Location |
|------|----------|
| Spine API | `app/routes/api+/queue-spine.tsx`, `app/features/queue/queue-spine.server.ts` |
| Hydration API | `app/routes/api+/tracks+/playback.tsx` |
| Client queue modules | `app/features/queue/` |
| Provider orchestration | `app/components/audio-player-provider.tsx` |
| Queue sheet UI | `app/components/audio-player.tsx`, `app/components/queue-sheet-ui.ts` |

## References

- Spec: `docs/specs/queue-spine-system.md`
- Product doc: `docs/AUDIO_PLAYER_AND_QUEUE.md`
- Type: `QueueTrack` in `app/types/frontend/shared.ts`
