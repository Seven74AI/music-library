# ADR-016: Usage Analytics and Admin User Monitoring

## Status

Accepted

**Date:** 2026-08-15

## Context

Opening the app to the public requires visibility into who is using the product and how, plus the ability to moderate accounts (disable, change roles, delete). Existing admin UI was ops-only (audio queue, cookies, FTS, cache). There was no play history, product analytics, or user management.

## Decision

### Events + daily time-series

- **`UsageEvent`** — append-only product events (`signup`, `login`, `library_add`, `play_started`, `play_completed`).
- **`DailyUsageStat`** — per-UTC-day counters (`signups`, `logins`, `library_adds`, `plays_started`, `plays_completed`, `dau`), incremented when events are recorded (no cron in v1).
- **`DailyActiveUser`** — unique `(day, userId)` so DAU increments at most once per user per UTC day on signup/login/play events. Signup qualifies because it creates a session without emitting a `login` event; without it a user who joins and never returns is missing from DAU. The dedupe row and the counter are written in one transaction, since a dedupe row without its increment would permanently suppress the retry.

Central write path: `recordUsageEvent` in `app/features/usage-analytics/`. It only swallows the unique-constraint (`P2002`) collision on the DAU dedupe row; every other failure propagates.

Play events are reported from the client after successful `audio.play()` and at ≥50% progress / `ended`, via `POST /resources/play-event`. Failures must not interrupt playback.

The endpoint verifies the `trackId` exists and applies a per-user fixed-window limit (60/min, `play-event-rate-limit.server.ts`). The express limiter in `server/index.ts` buckets by IP, which cannot stop a single authenticated account from inflating `plays_started`, `plays_completed`, and its own DAU.

A bulk library add writes one `UsageEvent` with `{"count":N}` in `meta` but bumps `library_adds` by `N`, so the metric counts tracks. The admin activity feed renders that count so the feed reconciles with the chart.

### Account disable

- **`User.disabledAt`** — soft block. Set by admin; clears all sessions. Checked in `getUserId` (existing cookies die, with a toast explaining why) and on login / WebAuthn (new sessions refused). An expired session is bounced silently, since that is routine.

### Admin UI

- `/admin` — overview totals + 30-day CSS/SVG bar charts from `DailyUsageStat`.
- `/admin/users` — searchable user list.
- `/admin/users/:userId` — detail, recent events, moderation (disable/enable, promote/demote admin, hard delete with username confirmation). The file is `users_.$userId.tsx`: the trailing underscore escapes `remix-flat-routes` nesting without changing the URL. Named `users.$userId.tsx`, the page mounts inside `/admin/users`, which renders no `<Outlet />`, so the whole moderation UI is unreachable.

Guards: cannot disable/demote/delete yourself; cannot demote or delete the last admin. Moderation helpers return `{ ok: false, reason: "not-found" | "forbidden", error }` so routes map failures to 404 or 400 without matching on message text.

## Consequences

- Historical plays before ship remain empty (no backfill).
- Charting uses simple CSS bars (no chart library dependency).
- UsageEvent rows grow with traffic; retention/pruning can be added later if needed.
