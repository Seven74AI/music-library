# ADR-021: Infinite Scroll on Search Results

## Status

Accepted

**Date:** 2026-09-01

## Context

Search (`app/routes/search.tsx` + `app/components/search-results.tsx`) already fetches via
`useFetcher` with a 400ms debounce, accumulates results across pages (`isLoadMore` ref), and
paginates by cursor. It ends each page in a **"Load More" button** (`SearchResults`), which is
inconsistent with the rest of the app and requires an explicit click to continue.

## Decision

- Replace the "Load More" button with an **IntersectionObserver sentinel** at the bottom of the
  results, inside the existing `overflow-y-auto` container. It auto-triggers `onLoadMore` when
  `hasNext && !isLoading`, with a small spinner shown while the next page loads.
- **Extract a shared `InfiniteScrollSentinel`** component (thin `IntersectionObserver` wrapper) and
  reuse it in both the user-playlists page (ADR-020) and search, instead of duplicating observer
  logic.

## Non-goals

- No change to the search backend, cursor shape, debounce, type filters, or the mixed-feed result
  ordering.
- No virtualization of the results list.
