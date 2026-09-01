# ADR-022: Artist Page — Full-Discography Queue + Infinite Scroll

## Status

Accepted

**Date:** 2026-09-01

## Context

The artist page (`app/routes/artists.$artistId.tsx`) and the queue spine for the artist context
(`fetchQueueSpine` in `app/features/queue/queue-spine.server.ts`) both hardcode `take: 50`. The
artist context is the _only_ queue context with a cap (library/playlist/album return every track),
and the album _page_ has no cap either. An artist with more than 50 tracks therefore gets a
truncated page and a truncated queue — only the first 50 make it in.

## Decision

- **Queue spine returns the full discography** — drop `take: 50` in the artist branch of
  `fetchQueueSpine`. Playing any artist track builds a queue of _all_ the artist's tracks.
- **Artist page tracks become cursor-paginated** via a dedicated **`/api/artist-tracks`** resource
  route returning `{ tracks, pagination }`. Page 1 is loaded by the page loader; subsequent pages
  are appended with `useFetcher` + the shared `InfiniteScrollSentinel` (ADR-021). A dedicated route
  is used so `albums` and `playlists` are not re-sent on every page.
- **Track rows use `usePlaybackIndex={false}`** so clicking resolves the queue position by track id
  in the _full_ spine (same as the search page), independent of how many rows are currently
  rendered.

## Non-goals

- No change to the artist page's albums section or its `createdAt desc` track ordering.
- No "play all" button (clicking any track already queues the full discography).
