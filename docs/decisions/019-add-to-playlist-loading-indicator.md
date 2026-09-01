# ADR-019: Add-to-Playlist Loading Indicator

## Status

Accepted

**Date:** 2026-09-01

## Context

`AddToPlaylistMenu` (`app/components/add-to-playlist-menu.tsx`) self-fetches the playlist list
from `/resources/playlists` when the `playlists` prop is omitted (the now-playing sheet path).
While that fetch is in flight, `filteredPlaylists.length === 0` falls into the _"No playlists yet"_
empty state, so the user briefly sees a wrong message before the list appears.

## Decision

- While `playlistsFetcher.state !== "idle"` **and** no data has arrived, render **2–3 skeleton rows**
  (the existing `ui/skeleton.tsx` shimmer) in place of the list, matching the row shape
  (title + track count) to avoid layout jump.
- "No playlists yet" remains only for the genuine empty case (fetch settled, zero results).
- When `playlists` is supplied as a prop there is no fetch, so no loading state — the list renders
  immediately, as today.

## Non-goals

- No spinner; no retry/error UI for the fetch (out of scope).
