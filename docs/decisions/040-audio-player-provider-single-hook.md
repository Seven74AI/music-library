# ADR-040: AudioPlayerProvider remains a single deep orchestrating hook

## Status

Accepted — recorded after PR #338 (audio-player god-module split).

## Context

The audio-player god-module cleanup (t_66da4da1) split two files:

- `app/components/audio-player.tsx` (2585 → 1133 lines) into seven cohesive UI
  modules plus a pure helper module — a clean, mechanical extraction.
- `app/components/audio-player-provider.tsx` (2063 → 1837 lines) only shrank by
  ~250 lines, because the only genuinely uncoupled code was the pure
  play-context / sort / persistence-predicate helpers (now
  `app/components/audio-player-play-context.ts`).

This left `AudioPlayerProvider` — a single React hook of ~1800 lines — still
above the >1000-line "critical god-module" threshold. The natural question: is
this a god module that should be split further, or a deep module whose size is
justified?

## Decision

`AudioPlayerProvider` is **one deep orchestrating hook**, not a god module. It
stays as-is. Its remaining callbacks are not separable concerns — they are
operations on a single shared state machine.

The hook owns one cohesive piece of state:

```
spine, spineOrder, spinePosition, upNext, upNextPlayNextCount,
currentTrack, playContext, loopMode, shuffleSeed, playbackToken,
cacheVersion, roomSpeaker, roomPlaying
```

plus ~15 refs (`playbackCacheRef`, persistence/room/restore refs) that the
queue-navigation, shuffle, online+offline restore, player-state persistence,
party-room speaker, queue auto-cache, and scroll-hydration callbacks all read
and mutate together. `playNext`, `restoreQueueFromServer`,
`syncRoomSpeakerQueue`, and the persistence effects each touch most of this
state.

A further split would thread ~25 setters/refs through parameters into sub-hooks
whose interfaces would be nearly as large as their implementations — the
definition of **shallow modules** (see the `codebase-design` skill: small
interface + large implementation = deep; large interface + thin implementation
= shallow). That increases coupling without adding leverage or locality: callers
would have to learn a 25-field parameter contract to invoke what is today one
hook's internal state.

Only pure, uncoupled logic was extracted (`audio-player-play-context.ts`), and
future extractions should follow the same rule: extract what is genuinely pure
(sort defaults, serialization, predicates), and leave the state-machine
orchestration in place.

## Consequences

- `AudioPlayerProvider` remains large (~1800 lines) but cohesive; its size is a
  property of the breadth of one feature (the playback queue state machine),
  not of unrelated responsibilities jammed into one file.
- The god-module threshold (>1000 lines) is treated as a *signal to inspect*,
  not a mandate to split. After inspection, this module is accepted as a deep
  module by explicit decision.
- Future decomposition of this hook should extract pure helpers only, or
  redesign the state machine itself — not mechanically subdivide the hook.
