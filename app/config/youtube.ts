/**
 * YouTube Configuration Constants
 *
 * This file contains ONLY configuration constants for YouTube API integration.
 * No business logic, mock data, or validation should be placed here.
 *
 * @see {@link ../utils/mock-generators.ts} for mock data generation
 * @see {@link ../types/youtube-api.ts} for API types and validation
 */

// YouTube API configuration constants
import { YOUTUBE_SERVICE } from "#app/constants/services";

export const YOUTUBE_API_BASE_URL = "https://youtube.googleapis.com/youtube/v3";
export const YOUTUBE_OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
// Single source of truth is YOUTUBE_SERVICE.ID (app/constants/services.ts) —
// the seed and tests reference the name-based constant so a reseeded id can't drift.
export const YOUTUBE_SERVICE_ID = YOUTUBE_SERVICE.ID;

// API endpoints
export const YOUTUBE_ENDPOINTS = {
  PLAYLISTS: "/playlists",
  PLAYLIST_ITEMS: "/playlistItems",
  VIDEOS: "/videos",
  SEARCH: "/search",
} as const;

// Rate limiting constants
export const YOUTUBE_RATE_LIMITS = {
  MIN_SEARCH_RESULTS: 1,
  MAX_SEARCH_RESULTS: 50,
  DEFAULT_SEARCH_RESULTS: 10,
  MIN_PLAYLIST_ITEMS: 1,
  MAX_PLAYLIST_ITEMS: 50,
  DEFAULT_PLAYLIST_ITEMS: 25,
  MIN_USER_PLAYLISTS: 1,
  MAX_USER_PLAYLISTS: 50,
  DEFAULT_USER_PLAYLISTS: 25,
} as const;

// API version
export const YOUTUBE_API_VERSION = "v3";

// OAuth scopes live in `app/utils/youtube-oauth.server.ts` (YOUTUBE_SCOPES) —
// the single authoritative source used by the actual OAuth request. Duplicate
// scope constants here previously drifted from that source.
