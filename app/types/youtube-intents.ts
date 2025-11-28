/**
 * Type-safe intent definitions for YouTube service actions
 * 
 * This module provides centralized intent constants and validation functions
 * for YouTube service operations across different pages.
 */

/**
 * Intent constants for playlist discovery page actions
 */
export const YOUTUBE_PLAYLIST_DISCOVERY_INTENTS = {
  ADD_TO_SYNC: 'add-to-sync',
  REMOVE_FROM_SYNC: 'remove-from-sync',
} as const

export type YouTubePlaylistDiscoveryIntent = typeof YOUTUBE_PLAYLIST_DISCOVERY_INTENTS[keyof typeof YOUTUBE_PLAYLIST_DISCOVERY_INTENTS]

/**
 * Intent constants for playlist detail page actions
 */
export const YOUTUBE_PLAYLIST_DETAIL_INTENTS = {
  REFRESH: 'refresh',
  REMOVE: 'remove',
  CONFIRM_DELETED_MATCH: 'confirm-deleted-match',
} as const

export type YouTubePlaylistDetailIntent = typeof YOUTUBE_PLAYLIST_DETAIL_INTENTS[keyof typeof YOUTUBE_PLAYLIST_DETAIL_INTENTS]

/**
 * Intent constants for synced playlists page actions
 */
export const YOUTUBE_SYNCED_PLAYLISTS_INTENTS = {
  RESYNC: 'resync',
  REMOVE: 'remove',
} as const

export type YouTubeSyncedPlaylistsIntent = typeof YOUTUBE_SYNCED_PLAYLISTS_INTENTS[keyof typeof YOUTUBE_SYNCED_PLAYLISTS_INTENTS]

/**
 * Union type for all YouTube intents
 */
export type YouTubeIntent = 
  | YouTubePlaylistDiscoveryIntent 
  | YouTubePlaylistDetailIntent 
  | YouTubeSyncedPlaylistsIntent

/**
 * Page type constants for better type safety
 */
export const YOUTUBE_PAGE_TYPES = {
  DISCOVERY: 'discovery',
  DETAIL: 'detail', 
  SYNCED: 'synced',
} as const

export type YouTubePageType = typeof YOUTUBE_PAGE_TYPES[keyof typeof YOUTUBE_PAGE_TYPES]

/**
 * Type-safe intent validation functions
 */
export function validatePlaylistDiscoveryIntent(intent: unknown): intent is YouTubePlaylistDiscoveryIntent {
  return typeof intent === 'string' && (Object.values(YOUTUBE_PLAYLIST_DISCOVERY_INTENTS) as readonly string[]).includes(intent)
}

export function validatePlaylistDetailIntent(intent: unknown): intent is YouTubePlaylistDetailIntent {
  return typeof intent === 'string' && (Object.values(YOUTUBE_PLAYLIST_DETAIL_INTENTS) as readonly string[]).includes(intent)
}

export function validateSyncedPlaylistsIntent(intent: unknown): intent is YouTubeSyncedPlaylistsIntent {
  return typeof intent === 'string' && (Object.values(YOUTUBE_SYNCED_PLAYLISTS_INTENTS) as readonly string[]).includes(intent)
}

/**
 * Get human-readable error messages for invalid intents
 */
export function getIntentErrorMessage(page: YouTubePageType): string {
  switch (page) {
    case YOUTUBE_PAGE_TYPES.DISCOVERY:
      return `Invalid intent. Must be one of: ${Object.values(YOUTUBE_PLAYLIST_DISCOVERY_INTENTS).join(', ')}`
    case YOUTUBE_PAGE_TYPES.DETAIL:
      return `Invalid intent. Must be one of: ${Object.values(YOUTUBE_PLAYLIST_DETAIL_INTENTS).join(', ')}`
    case YOUTUBE_PAGE_TYPES.SYNCED:
      return `Invalid intent. Must be one of: ${Object.values(YOUTUBE_SYNCED_PLAYLISTS_INTENTS).join(', ')}`
    default:
      return 'Invalid intent'
  }
}
