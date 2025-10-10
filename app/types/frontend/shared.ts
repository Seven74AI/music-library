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
  artist: string
  album: string | null
  duration: number | null
  externalId: string | null
  serviceId: string | null
  serviceUrl: string | null
  thumbnailUrl: string | null
  releaseDate: Date | null
  createdAt: Date
  updatedAt: Date
  position: number
  isInUserLibrary: boolean
  service?: {
    name: string
    displayName: string
    logoUrl: string | null
  }
  audioFile?: {
    objectKey: string | null
    status: string
    priority: boolean
  } | null
}
