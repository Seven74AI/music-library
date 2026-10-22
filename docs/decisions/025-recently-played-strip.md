# ADR-025: Recently Played Strip on Listening Hub

## Status

Accepted (product decisions from `/grill-with-docs`; implementation not started)

**Tracking:** [#199](https://github.com/mnlamart/music-library/issues/199)

**Date:** 2026-09-23

## Context

ADR-017 shipped `/history` as a per-play chronological list from `play_started`, and deferred a home-page “Recently played” strip to avoid colliding with the existing “recent tracks” (= recently **added**) row. The listening hub still lacks a fast “what did I actually finish lately?” surface.

## Decision

### Placement

- Add a **Recently Played Strip** on the logged-in listening hub (`/`), **above** the recent-playlists section.
- Keep **recently added** as-is — do not replace or rename it in this change.

### Ranking and membership

- Source: **`play_completed`** **UsageEvent**s only (not `play_started`). Aligns with “real listens” used by **On-Repeat Snapshot** (ADR-024).
- **Distinct tracks** — collapse repeats: one tile per `trackId`, ordered by most recent `play_completed` `createdAt`.
- Cap: **20** tiles. Fewer completes → show whatever exists; zero → hide the strip (no empty section).

### Relationship to `/history`

- `/history` stays per-play, `play_started`-based, with completed badge via `playId` (ADR-017). No change.
- The strip is a separate, collapsed, completions-only home affordance — not a preview of the history page’s row model.

## Non-goals

- Changing `/history` list semantics or data source.
- Replacing or merging with recently added.
- On-Repeat Snapshot shelf placement (sibling idea). **Heavy Rotation** is settled in ADR-026. **Weekly Wrap** is settled in ADR-027. **Personal Play Boost** is settled in ADR-028.

## Consequences

- Glossary: **Recently Played Strip** (`docs/CONTEXT.md` decision #62).
- Listening-hub loader needs a distinct-track query over `play_completed` (join `Track`, skip dangling IDs as history does).
- May want a “See all” link to `/history`; optional, not required by this ADR.
