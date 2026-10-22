# ADR-027: Weekly Wrap

## Status

Accepted (product decisions from `/grill-with-docs`; implementation not started)

**Tracking:** [#201](https://github.com/mnlamart/music-library/issues/201)

**Date:** 2026-09-23

## Context

Listening hub is gaining play-derived surfaces (**Recently Played Strip**, **Heavy Rotation**, **On-Repeat Snapshot** shelf). A light “how am I listening this week?” signal is useful without another track strip or a loud wrap card. Admin **DailyUsageStat** already aggregates plays for operators — this is listener-facing and personal.

## Decision

### Period

- **Current UTC calendar week, Monday–Sunday** (ISO-style week in UTC).
- Live for the in-progress week (not a frozen prior-week archive in v1).

### Metrics (quiet)

From the user’s `play_completed` **UsageEvent**s in that week:

- **Finishes** — count of `play_completed` events.
- **Unique tracks** — count of distinct `trackId`s among those events.
- **Day streak** — consecutive UTC days ending today with ≥1 `play_completed`. Show the streak **only when > 1** (avoid noisy “streak: 1”).

No top-track / top-artist hero in v1 (keeps tone quiet; home already has track strips).

### Surface and empty state

- **Home (listening hub) only** — not on `/history` in v1.
- **Hide when empty** — zero finishes in the current week → omit the wrap entirely.

## Non-goals

- Frozen weekly archives or email/push digests.
- Unique-artists metric or loud “wrapped” storytelling UI in v1.
- `/history` header placement.
- **Personal Play Boost** is settled in ADR-028.

## Consequences

- Glossary: **Weekly Wrap** (`docs/CONTEXT.md` decision #64).
- Home loader aggregates week-bounded `play_completed` counts + optional streak; no new tables required for v1.
