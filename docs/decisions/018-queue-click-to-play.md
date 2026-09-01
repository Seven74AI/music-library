# ADR-018: Queue Click-to-Play

## Status

Accepted

**Date:** 2026-09-01

## Context

The queue sheet (`app/components/audio-player.tsx` → `QueueSheet`) renders three zones —
**Now playing**, **Up Next**, and the **spine** (the remainder of the active library/playlist/
artist/album source). Rows in all three zones are currently inert except for a remove button;
there is no way to jump the queue to a specific track. Users can only skip forward/back, remove
tracks, or add to up-next. This is inconsistent with every other list in the app, where clicking
a row plays that track immediately.

The audio-player provider already exposes the primitives needed (`playTrack`, `playNextTrack`,
`addToUpNext`, `addToQueue`, `removeTrackFromPlaylist`, `removeCurrentFromQueue`), but there is
**no "jump to this position in the current queue"** operation — `playTrack` always rebuilds the
queue from a fresh context.

## Decision

Clicking a queue row plays that track immediately:

- **Spine row** — advance the queue to that track (move `spinePosition`) and play it. Tracks
  skipped over ahead of it are discarded.
- **Up Next row** — play it immediately; drop it and anything before it from Up Next.
- **Now playing row** — toggle play/pause (no queue rebuild).

**Shuffle:** a jump advances position _within_ the existing `spineOrder` permutation (the seeded
shuffle stays intact); it does not re-shuffle from the clicked track.

**Seam:** one new provider function, `playQueueTrack(target: QueueTarget)` (`QueueTarget =
{ zone: "upNext" | "spine"; index: number }`, already defined in `queue-navigation.ts`):

- resolve the track with `getTrackAtTarget`;
- spine → `spinePosition = index`; upNext → trim to `upNext.slice(index + 1)` (discarding
  `0..index`) and decrement `upNextPlayNextCount` by the number of "play next" items discarded;
- play via `playResolvedTrack`.

Loop mode is left unchanged — `loop="one"` re-applies to the new current track (it reads
`spinePosition`), and Up Next already takes priority over loop-one in `resolveNextTrack`. The
`QueueSheet` maps display rows back to a play-order index the same way `removeSpineTrack` does
(`spinePosition + 1 + displayIndex`).

## Non-goals

- No drag-to-reorder of the queue.
- No undo of the discard when jumping (skipped tracks are gone, same as skip-forward today).
- No change to how a new context (library/playlist/artist/album) _builds_ the queue — this only
  adds navigation _within_ an already-built queue.
