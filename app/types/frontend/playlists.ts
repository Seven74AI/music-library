/**
 * Frontend Playlist Types
 * 
 * This file defines type-safe interfaces for playlist-related frontend components.
 * 
 * @example
 * ```typescript
 * import { type PlaylistWithTracks, type PlaylistSummary } from '#app/types/frontend/playlists'
 * 
 * const playlist: PlaylistWithTracks = useLoaderData()
 * ```
 */

// ============================================================================
// PLAYLIST TYPES
// ============================================================================

/**
 * Playlist with tracks for frontend display
 */
export interface PlaylistWithTracks {
  id: string
  title: string
  description: string | null
  externalId: string
  serviceId: string
  ownerId: string
  itemCount: number
  channelId: string | null
  channelTitle: string | null
  thumbnailUrl: string | null
  publishedAt: Date | null
  lastSyncedAt: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  tracks: TrackWithUserStatus[]
}

/**
 * Playlist summary for lists and cards
 */
export interface PlaylistSummary {
  id: string
  title: string
  description: string | null
  itemCount: number
  channelTitle: string | null
  thumbnailUrl: string | null
  lastSyncedAt: Date | null
  isActive: boolean
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

import { type TrackWithUserStatus } from './shared'
import { hasProperty, isString, isArray } from './type-guards'

/**
 * Type guard to check if object is PlaylistWithTracks
 */
export function isPlaylistWithTracks(obj: unknown): obj is PlaylistWithTracks {
  if (!hasProperty(obj, 'id') || !hasProperty(obj, 'title') || !hasProperty(obj, 'tracks')) {
    return false
  }
  
  return (
    isString(obj.id) &&
    isString(obj.title) &&
    isArray(obj.tracks)
  )
}
