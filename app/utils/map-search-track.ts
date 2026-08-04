import { type TrackSearchResult } from "#app/types/search.ts";

export function mapSearchTrackToListItem(result: TrackSearchResult) {
  return {
    id: result.id,
    title: result.title,
    artist: { id: result.artistId, name: result.artistName },
    duration: result.duration ?? null,
    coverImage: result.coverImage ?? null,
    serviceUrl: result.serviceUrl ?? null,
    service: result.service ?? null,
    audioFiles: result.audioFiles ?? [],
    isInUserLibrary: true,
  };
}
