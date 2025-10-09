/**
 * Frontend Utility Types
 * 
 * This file defines utility types and interfaces for frontend components.
 * 
 * @example
 * ```typescript
 * import { type PaginationInfo, type SearchFilters } from '#app/types/frontend/utils'
 * 
 * const pagination: PaginationInfo = useLoaderData()
 * ```
 */

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Pagination info for lists
 */
export interface PaginationInfo {
  page: number
  limit: number
  total: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Search filters for tracks and playlists
 */
export interface SearchFilters {
  query?: string
  service?: string
  channel?: string
  dateRange?: {
    start: Date
    end: Date
  }
}

/**
 * Sort options for lists
 */
export interface SortOptions {
  field: string
  direction: 'asc' | 'desc'
}
