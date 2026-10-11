/**
 * Shared types and constants for Discover functionality
 * These can be imported by both client and server code
 */

import { type SortDirection } from "#app/utils/sort-direction.ts";

export const DISCOVER_TRACKS_PAGE_SIZE = 50;

export const DISCOVER_SORT_OPTIONS = [
  "recentlyAdded",
  "mostPlayed",
  "mostLiked",
  "titleAZ",
  "artistAZ",
] as const;

export type DiscoverSortOption = (typeof DISCOVER_SORT_OPTIONS)[number];

export const DEFAULT_DISCOVER_SORT: DiscoverSortOption = "recentlyAdded";

export function parseDiscoverSort(raw: string | null | undefined): DiscoverSortOption {
  return DISCOVER_SORT_OPTIONS.includes(raw as DiscoverSortOption)
    ? (raw as DiscoverSortOption)
    : DEFAULT_DISCOVER_SORT;
}

export function defaultDiscoverSortDirection(sort: DiscoverSortOption): SortDirection {
  if (sort === "recentlyAdded" || sort === "mostPlayed" || sort === "mostLiked") {
    return "desc";
  }
  return "asc";
}

export type TrackPopularityStats = {
  globalPlayCount: number;
  globalLikeCount: number;
  userPlayCount: number;
};

export type DiscoverTrack = {
  id: string;
  title: string;
  duration: number | null;
  serviceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  releaseDate: Date | null;
  originalDate: Date | null;
  artist: {
    id: string;
    name: string;
  };
  albumRecord: {
    id: string;
    name: string;
  } | null;
  coverImage: {
    objectKey: string;
  } | null;
  service: {
    name: string;
    displayName: string;
    logoUrl: string | null;
  } | null;
  audioFiles: Array<{
    id: string;
    format: string | null;
    objectKey: string;
  }>;
  isInUserLibrary: boolean;
  userTrackCreatedAt: Date | null;
  popularityStats?: TrackPopularityStats;
};
