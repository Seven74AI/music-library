# ADR-026: Heavy Rotation (This Month + Ever)

## Status

Accepted (product decisions from `/grill-with-docs`; implementation not started)

**Tracking:** [#200](https://github.com/mnlamart/music-library/issues/200)

**Date:** 2026-09-23

**Updated:** 2026-09-23 — add lifetime (“ever”) window; dual home strips; library sorts uncapped and mutually exclusive.

## Context

**On-Repeat Snapshot** (ADR-024) freezes last month’s top completes on the 1st. Users also need **live** views of what they finish **this month** and what they have finished **over all time** — without waiting for month-end or creating another frozen playlist. ADR-017 already noted “most played” as a separate feature from per-play history.

## Decision

### Signal and windows

- Source: **`play_completed`** only (same “real listen” signal as ADR-024 / ADR-025).
- Two windows:
  - **This month** — current UTC calendar month (“this month so far”).
  - **Ever** — lifetime (all `play_completed` for the user).
- Distinct tracks ranked by completed-play count descending.
- Recomputed on read — **not** persisted as snapshots.

### Relationship to On-Repeat Snapshot

- **Heavy Rotation** = live rankings (this month / ever).
- **On-Repeat Snapshot** = frozen previous calendar month (generated on the 1st).
- They complement; Heavy Rotation is not a second snapshot series.

### Surfaces

1. **Listening-hub strips** on `/` — **two strips** (this month + ever). Each capped at **50** tiles. **Hide** a strip when that window has zero qualifying tracks.
2. **Personal Library sorts** on `/library` — **two mutually exclusive sort options** (“Most played · this month” / “Most played · ever”). Only one active at a time (sort menu / radio behavior — not multi-select checkboxes). The chosen sort reorders the **full** library list by that window’s counts with **no 50 cap** (users can browse/search beyond the home-strip preview). Tracks with zero completes in the chosen window sort after those with counts (exact tie-break left to implementation).

Home strip placement relative to **Recently Played Strip** / Snapshot Shelf is an implementation/layout detail; strips may coexist.

## Non-goals

- Persisting Heavy Rotation as dated snapshots.
- Rolling windows other than “this UTC month” / lifetime.
- Combining both library sorts at once.
- Changing `/history` semantics.
- **Weekly Wrap** is settled in ADR-027. **Personal Play Boost** is settled in ADR-028.

## Consequences

- Glossary: **Heavy Rotation** (`docs/CONTEXT.md` decision #63).
- Shared query helpers for `play_completed` counts by `trackId` for (a) current UTC month and (b) lifetime — reusable by home loaders and library sort.
- Library UI gains two sort values; home gains two strips with independent empty-hide behavior.
