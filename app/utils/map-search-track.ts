import { type TrackSearchResult } from "#app/types/search.ts";

export function mapSearchTrackToListItem(result: TrackSearchResult) {
  return {
    id: result.id,
    title: result.title,
    artist: { id: result.artistId, name: result.artistName },
    album:
      result.albumId && result.albumName ? { id: result.albumId, name: result.albumName } : null,
    duration: result.duration ?? null,
    coverImage: result.coverImage ?? null,
    serviceUrl: result.serviceUrl ?? null,
    service: result.service ?? null,
    audioFiles: result.audioFiles ?? [],
    isInUserLibrary: Boolean(result.addedAt),
    popularityStats: result.popularityStats,
  };
}
