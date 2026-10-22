# ADR-024: On-Repeat Snapshots

## Status

Accepted (product decisions from `/grill-with-docs`; implementation not started)

**Tracking:** [#198](https://github.com/mnlamart/music-library/issues/198)

**Date:** 2026-09-21

**Updated:** 2026-09-23 — cadence vs window clarified; empty/thin months and retention settled.

## Context

`UsageEvent` already records `play_started` and `play_completed` (with `playId` correlation; ADR-016 / ADR-017). `/history` lists per-play rows. The product wants a durable “what I actually finished lately” artifact — not only a live aggregation — that users can revisit and optionally copy into a normal playlist.

Related shortlist: **Recently Played Strip** (ADR-025), **Heavy Rotation** (ADR-026), **Weekly Wrap** (ADR-027), **Personal Play Boost** (ADR-028).

Early grilling said “30 day,” which was ambiguous between generation cadence and ranking window. Settled: monthly generation on the 1st; ranking covers the previous calendar month (not a rolling 30-day lookback).

## Decision

### Generation cadence vs ranking window

These are separate knobs:

- **Cadence** — when a new snapshot is created: **1st of each month** (one new **On-Repeat Snapshot** per user per run, subject to empty-month skip below).
- **Window** — which plays count for that snapshot: the **previous calendar month** in **UTC** (aligned with **DailyUsageStat** UTC day boundaries). Example: on 1 Oct → rank `play_completed` events with `createdAt` in September (UTC).

Rejected: rolling “last 30 days from generation time.”

### Ranking signal

- Include only **`play_completed`** events. Do **not** count `play_started` (skips would inflate the list).
- Rank tracks by completed-play count descending within the window; take the top **30**. Tie-break (e.g. most recent `play_completed`, then `trackId`) is an implementation detail and may be fixed in the PRD/impl ADR addendum.

### Empty and thin months

- **Empty month (0 qualifying `play_completed` events):** **skip** — do not create a snapshot. Keeps the **Snapshot Shelf** free of hollow “0 tracks” months.
- **Thin month (1–29 qualifying tracks):** **still create** a short snapshot with whatever qualifies. A real listening month deserves an artifact even below the cap.

### Retention

- **Keep all snapshots in v1** — no automatic prune. The shelf shows the latest 3; the history page lists the rest (paginate as needed).
- Matches ADR-016’s deferral of UsageEvent retention; revisit prune (e.g. last 12/24 months) only if history storage becomes a problem.
- Rejected for v1: hard-delete older than N months; soft-archive with hidden rows.

### Persistence model — dated snapshots

- Each generation produces a new **On-Repeat Snapshot** frozen at that moment (track set + per-track counts for that month). Later plays do not rewrite older snapshots.
- Rejected: a single replace-in-place “smart playlist” (loses history the user asked to keep).

### UI

- **Snapshot Shelf** — show the **latest 3** snapshots, plus a control to a page listing **all** snapshots for the user.
- Snapshot detail is **read-only** (no reorder, remove, rename-as-user-playlist, or manual add/remove of members).
- Each track row shows the **number of completed listens** in that snapshot’s month.
- **Promote Snapshot** — primary mutation affordance: add **all** snapshot tracks to a **new or existing UserPlaylist** (reuse existing add-to-playlist / create-playlist flows where practical). The snapshot itself is unchanged.

### Separation from UserPlaylist

- On-Repeat Snapshots are **not** editable **UserPlaylist**s. Mixing them into the normal `/playlists` editable list would fight read-only rules and per-user title uniqueness. Prefer a dedicated model (or clearly flagged system entity) owned by the user; exact schema is left to implementation, as long as Promote copies into a real **UserPlaylist**.

## Non-goals (this ADR)

- Using `play_started`, non-calendar windows, or caps other than 30.
- Per-user local timezone for month boundaries (UTC only for v1).
- Retention/pruning policies beyond “keep forever in v1.”
- Recently played strip, Heavy rotation, Weekly wrap, or search ranking boosts (sibling ideas).
- Mid-track resume or changing ADR-017 history semantics.

## Consequences

- New glossary terms: **On-Repeat Snapshot**, **Snapshot Shelf**, **Promote Snapshot** (`docs/CONTEXT.md`).
- Needs a monthly generation job (1st of month), storage for snapshot header + ranked members with counts, shelf + history + detail routes, and Promote actions wired to **UserPlaylist** helpers.
- Generation must be idempotent per `(userId, year-month)` so a retry on the 1st does not duplicate snapshots; empty months leave a gap in the series (by design).
