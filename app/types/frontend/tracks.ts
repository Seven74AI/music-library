/**
 * Frontend Track Types
 * 
 * This file defines type-safe interfaces for track-related frontend components.
 * 
 * @example
 * ```typescript
 * import { type TrackWithUserStatus } from '#app/types/frontend/tracks'
 * 
 * const track: TrackWithUserStatus = useLoaderData()
 * ```
 */

import { type TrackWithUserStatus } from './shared'
import { 
  isString, 
  isStringOrNull, 
  isNumberOrNull, 
  isDateOrNull, 
  isDate, 
  isNumber, 
  isObject 
} from './type-guards'

// ============================================================================
// TRACK TYPES
// ============================================================================

// TrackWithUserStatus is defined in playlists.ts to avoid circular imports
// This file is kept for future track-specific types

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if object is TrackWithUserStatus
 * Note: TrackWithUserStatus is defined in playlists.ts
 */
export function isTrackWithUserStatus(obj: unknown): obj is TrackWithUserStatus {
  if (!isObject(obj)) return false
  
  return (
    isString(obj.id) &&
    isString(obj.title) &&
    isObject(obj.artist) &&
    isString(obj.artist.id) &&
    isString(obj.artist.name) &&
    isNumberOrNull(obj.duration) &&
    isStringOrNull(obj.externalId) &&
    isStringOrNull(obj.serviceId) &&
    isStringOrNull(obj.serviceUrl) &&
    (obj.coverImage === null || (
      isObject(obj.coverImage) &&
      isString(obj.coverImage.objectKey)
    )) &&
    isDateOrNull(obj.releaseDate) &&
    isDate(obj.createdAt) &&
    isDate(obj.updatedAt) &&
    isNumber(obj.position) &&
    (obj.service === undefined || (
      isObject(obj.service) &&
      isString(obj.service.name) &&
      isString(obj.service.displayName) &&
      isStringOrNull(obj.service.logoUrl)
    ))
  )
}
