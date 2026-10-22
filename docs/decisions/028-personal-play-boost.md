# ADR-028: Personal Play Boost on Global FTS

## Status

Accepted — implemented for global FTS track search (#202)

**Tracking:** [#202](https://github.com/mnlamart/music-library/issues/202)

**Date:** 2026-09-23

## Context

Global FTS (ADR-009) ranks by text relevance only. Listeners repeatedly search for tracks they already finish often; a light personal signal can surface those without turning search into a “most played” list. **Heavy Rotation** already covers explicit most-played browsing on home and `/library` (ADR-026).

## Decision

### Scope

- **Personal only** — boost from the **current user's** `play_completed` **UsageEvent**s. Never a cross-user / global popularity rank.
- **Global FTS only** in v1 — do not change ServicePlaylist browse ordering.
- `/library` most-played behavior stays the explicit **Heavy Rotation** sorts (ADR-026), not this boost.

### Signal

- **Lifetime** `play_completed` counts by `trackId` for that user.
- Rejected for v1: 90-day decay, this-month-only boost (those windows already appear on Heavy Rotation / Weekly Wrap).

### Strength

- **Soft boost** — text relevance remains the primary ranking signal; personal play counts nudge already-matching results upward (implementation may use a bounded score additive/multiplicative term). Hard re-rank “sort matches only by plays” is rejected.

## Non-goals

- Global (all-users) popularity ranking.
- Boosting ServicePlaylist or non-FTS browse lists in v1.
- Replacing Heavy Rotation strips/sorts.
- Changing FTS index schema beyond whatever join/score hook implementation needs.

## Consequences

- Glossary: **Personal Play Boost** (`docs/CONTEXT.md` decision #65).
- Search path must load (or cache) the authed user's lifetime play counts and apply them only when a user session exists; logged-out search stays relevance-only.
- Formula details (weights, caps) belong in the implementation PR / tests — this ADR locks product intent only.

This completes the listening-insights shortlist from the grill session: ADR-024…028.
