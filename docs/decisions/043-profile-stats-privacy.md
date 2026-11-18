# ADR-043: Profile Stats and Per-Block Privacy

## Status

Accepted

**Tracking:** [#458](https://github.com/Seven74AI/music-library/issues/458)

**Date:** 2026-11-18

## Context

The public profile (`/users/:username`) showed only avatar, name and join date, although the app already records per-user listening data (ADR-016, ADR-026). Listening stats are personal, so they need owner-controlled visibility.

## Decision

### Signal and semantics

- Source: **`play_completed`** only (never `play_started`), consistent with ADR-016/026.
- Window: **all-time** only. No time-range control.
- `play_completed` fires at 50% progress, so "plays" are labeled **completed plays** and listening time credits the full `Track.duration` per completed play. This overstates real listening for tracks skipped at half — accepted and documented.
- `Track.duration` is read at query time, so a later duration backfill (decision #36) retroactively changes listening time — accepted.
- `Track.duration` is nullable: nulls contribute 0 seconds, but the play still counts.

### Blocks

- **Top tracks / top artists** — top 10 each. `GROUP BY … ORDER BY count DESC LIMIT 10` in SQL (no full-map materialization); inner join to `Track` drops dangling/null trackIds. Tie-break: count desc → latest `play_completed.createdAt` desc → entity id asc. Detail lookups use `chunkArray` (500/chunk). Static rows (no audio/cover/service fields).
- **Totals** — completed plays, library size, listening time, over one denominator (`play_completed` joined to an existing Track). Library size = `UserTrack` with `isActive: true AND deletedAt: null` (decision #29). Block renders if any metric is non-zero.

### Privacy

- New 1:1 `ProfilePrivacy` (`showTopTracks`, `showTopArtists`, `showTotals`, default `true`).
- **Public by default**: stats are visible unless the owner opts out, so profiles are not empty without effort. The settings page carries an explicit notice.
- **Missing row ⇒ all public** (`findUnique` + fallback constants; never `findUniqueOrThrow`), so pre-migration users need no backfill.
- **Enforced at data time**: the loader neither computes nor returns a disabled block. Hidden data never reaches the client; tests assert the loader return value.
- The owner alone receives `hiddenBlocks` so their own profile can show a "hidden from visitors" placeholder.
- Edited via the `privacy-update` intent on `/settings/profile`: three checkboxes parsed with `z.preprocess(v => v === "on", z.boolean())`, so unchecked ⇒ `false`; all three are written on every submit (upsert, scoped to the session user).

## Non-goals

- Monthly/other windows, recently played, weekly wrap or on-repeat on the profile.
- Privacy finer than per-block.
- Playable/clickable top items.
- Gating profiles of `disabledAt` accounts (unchanged; their stats stay publicly viewable — possible follow-up).

## Consequences

- Public profiles expose listening taste by default; owners must opt out.
- Aggregates run per profile view over indexed `UsageEvent (userId, type, trackId)`; bounded by LIMIT 10 but not cached.
