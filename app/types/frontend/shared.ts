/**
 * Shared Frontend Types
 * 
 * This file contains types that are shared across multiple frontend modules
 * to avoid circular import issues.
 * 
 * @example
 * ```typescript
 * import { type TrackWithUserStatus } from '#app/types/frontend/shared'
 * 
 * const track: TrackWithUserStatus = useLoaderData()
 * ```
 */

// ============================================================================
// SHARED TYPES
// ============================================================================

/**
 * Track with user library status for frontend display
 * This type is shared between playlists and tracks modules
 */
export interface TrackWithUserStatus {
  id: string
  title: string
  artist: {
    id: string
    name: string
  }
  duration: number | null
  externalId: string | null
  serviceId: string | null
  serviceUrl: string | null
  coverImage: {
    objectKey: string
  } | null
  releaseDate: Date | null
  createdAt: Date
  updatedAt: Date
  position: number
  isDeleted?: boolean
  deletedAt?: Date | null
  service?: {
    name: string
    displayName: string
    logoUrl: string | null
  }
  audioFiles?: Array<{
    id: string
    format: string | null
    objectKey: string
  }>
}

/**
 * Minimal track data for queue display
 * Used for efficient queue management with large libraries
 */
export interface QueueTrack {
  id: string
  title: string
  artist: {
    id: string
    name: string
  }
}

/**
 * Full track data for playback
 * Extends QueueTrack with all necessary playback information
 */
export interface FullTrack {
  id: string
  title: string
  artist: {
    id: string
    name: string
  }
  duration: number | null
  coverImage: {
    objectKey: string
  } | null
  audioFiles?: Array<{
    id: string
    format: string | null
    objectKey: string
  }>
}
