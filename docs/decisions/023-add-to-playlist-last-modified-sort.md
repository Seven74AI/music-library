# ADR-023: Add-to-Playlist "Last Modified" Sort

## Status

Accepted

**Date:** 2026-09-01

## Context

The add-to-playlist menu already lists playlists sorted by `updatedAt desc` in both code paths
(`/resources/playlists` and `loadUserPlaylists`). But `UserPlaylist.updatedAt` is only touched when
the playlist _row_ is created or renamed — `addTrackToUserPlaylist` (and the remove/reorder actions)
only mutate `UserPlaylistTrack`, never the parent. So "last modified" today means "last
renamed/created", not "last time I changed its contents". There is already a `[ownerId, updatedAt]`
index, so the sort is cheap.

## Decision

- Bump `UserPlaylist.updatedAt` on **every content mutation**: add-track
  (`user-playlist.server.ts`), remove-track and reorder (`playlists.$playlistId.tsx` actions), and
  the bulk service-playlist import. Each mutation issues a `prisma.userPlaylist.update` (ideally in
  the same transaction as the content change) so `@updatedAt` reflects the last content change.
- No change to the sort itself — it already orders by `updatedAt desc`.

## Non-goals

- No live re-sort of an already-open menu; the next open reflects the new order.
- No change to the `@updatedAt`/`@createdAt` schema or the existing index.
