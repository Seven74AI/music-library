# ADR-020: Infinite Scroll on User Playlists Page

## Status

Accepted

**Date:** 2026-09-01

## Context

The "My Playlists" page (`app/routes/playlists.index.tsx`) already cursor-paginates server-side
(default `limit=12`, `orderBy: updatedAt desc`) and returns `{ hasNext, nextCursor }`, but ends each
page in a "Load More" `NavLink` (full navigation). Sort (name / created / updated / track-count) and
the search box are applied **client-side over only the loaded page**, which is inconsistent with
pagination and breaks under infinite scroll.

## Decision

- **Sort and search move server-side** — `sort` and `q` become loader query params; every page is
  fetched already-filtered/sorted. The client-side `useState` sort/filter is removed.

- **Append via `useFetcher` + `IntersectionObserver`.** A shared `InfiniteScrollSentinel`
  component (see ADR-021) sits at the bottom of the list; when it enters the viewport and
  `hasNext && fetcher.state === "idle"`, `fetcher.load("?cursor=…&sort=…&q=…")` and the page is
  appended to a local accumulated list seeded from the route loader's page 1. The "Load More"
  `NavLink` is removed.

- **Sort/search changes do a full navigation** (`navigate("?sort=…&q=…")`, no cursor) → the loader
  re-runs and returns a fresh page 1, resetting the accumulated list. The URL remains the single
  source of truth; page 1 is never special-cased through a fetcher reset.

## Non-goals

- No virtualization (the list is not track-sized).
- No change to the default ordering (`updatedAt desc`) or the four sort options.
