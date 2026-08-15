/**
 * Search result types and interfaces for global search functionality
 */

export type SearchResultType = "track" | "album" | "artist" | "playlist";

export type SearchFilterType = "all" | "tracks" | "albums" | "artists" | "playlists";

export interface BaseSearchResult {
  id: string;
  type: SearchResultType;
  relevance: number;
}

export interface TrackSearchResult extends BaseSearchResult {
  type: "track";
  title: string;
  artistName: string;
  albumName?: string | null;
  artistId: string;
  albumId?: string | null;
  duration?: number | null;
  coverImageId?: string | null;
  serviceId?: string | null;
  serviceUrl?: string | null;
  coverImage?: { objectKey: string } | null;
  service?: { displayName: string; logoUrl: string | null } | null;
  audioFiles?: Array<{ id: string; format: string | null; objectKey: string }>;
  addedAt?: string;
}

export interface AlbumSearchResult extends BaseSearchResult {
  type: "album";
  name: string;
  artistName: string;
  artistId: string;
  year?: number | null;
  coverImageId?: string | null;
}

export interface ArtistSearchResult extends BaseSearchResult {
  type: "artist";
  name: string;
  genre?: string | null;
}

export interface PlaylistSearchResult extends BaseSearchResult {
  type: "playlist";
  name: string;
  trackCount: number;
  ownerName: string;
  description?: string | null;
  itemCount: number;
  thumbnailUrl?: string | null;
}

export type SearchResult =
  | TrackSearchResult
  | AlbumSearchResult
  | ArtistSearchResult
  | PlaylistSearchResult;

export interface SearchResponse {
  results: SearchResult[];
  pagination: {
    limit: number;
    hasNext: boolean;
    nextCursor: string | null;
  };
  /** Present on error responses that still include an empty results shape */
  error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Type guard for a successful/stable search API payload */
export function isSearchResponse(value: unknown): value is SearchResponse {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.results)) return false;
  if (!isObject(value.pagination)) return false;
  const { pagination } = value;
  return (
    typeof pagination.limit === "number" &&
    typeof pagination.hasNext === "boolean" &&
    (pagination.nextCursor === null || typeof pagination.nextCursor === "string")
  );
}
