/**
 * Frontend YouTube Types
 * 
 * This file defines type-safe interfaces for YouTube-related frontend components.
 * 
 * @example
 * ```typescript
 * import { type YouTubePlaylistDisplay } from '#app/types/frontend/youtube'
 * 
 * const playlist: YouTubePlaylistDisplay = useLoaderData()
 * ```
 */

// ============================================================================
// YOUTUBE API TYPES (for frontend display)
// ============================================================================

/**
 * YouTube playlist for frontend display (from API)
 */
export interface YouTubePlaylistDisplay {
  id: string
  snippet: {
    title: string
    description: string | null
    channelTitle: string
    thumbnails: {
      default?: { url: string }
      medium?: { url: string }
      high?: { url: string }
    }
  }
  contentDetails: {
    itemCount: number
  }
  isSynced: boolean
  playlistInternalId: string | null
}

/**
 * YouTube playlist item for frontend display (from API)
 */
export interface YouTubePlaylistItemDisplay {
  id: string
  snippet: {
    title: string
    description: string | null
    channelTitle: string
    videoOwnerChannelTitle: string
    thumbnails: {
      default?: { url: string }
      medium?: { url: string }
      high?: { url: string }
    }
  }
  contentDetails: {
    videoId: string
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

import { hasProperty, isString, isObject, isNumber } from './type-guards'

/**
 * Type guard to check if object is YouTubePlaylistDisplay
 */
export function isYouTubePlaylistDisplay(obj: unknown): obj is YouTubePlaylistDisplay {
  if (!hasProperty(obj, 'id') || !hasProperty(obj, 'snippet') || !hasProperty(obj, 'contentDetails')) {
    return false
  }
  
  return (
    isString(obj.id) &&
    isObject(obj.snippet) &&
    isString(obj.snippet.title) &&
    isObject(obj.contentDetails) &&
    isNumber(obj.contentDetails.itemCount)
  )
}
