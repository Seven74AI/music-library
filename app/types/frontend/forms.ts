/**
 * Frontend Form Types
 * 
 * This file defines type-safe interfaces for form-related frontend components.
 * 
 * @example
 * ```typescript
 * import { type PlaylistSyncFormData } from '#app/types/frontend/forms'
 * 
 * const formData: PlaylistSyncFormData = useActionData()
 * ```
 */

import { type TrackWithUserStatus } from './shared'
import { isObject, isString } from './type-guards'

// ============================================================================
// FORM TYPES
// ============================================================================

/**
 * Playlist sync form data
 */
export interface PlaylistSyncFormData {
  playlistId: string
  action: 'sync' | 'remove'
}

/**
 * Track import form data
 */
export interface TrackImportFormData {
  url: string
  serviceName: string
}

// ============================================================================
// ACTION RESULT TYPES
// ============================================================================

/**
 * Standard action result for forms
 */
export interface ActionResult<T = unknown> {
  status: 'success' | 'error'
  message: string
  data?: T
}

/**
 * Playlist sync result
 */
export interface PlaylistSyncResult {
  success: boolean
  playlistId: string
  tracksAdded: number
  totalTracks: number
  message?: string
}

/**
 * Track import result
 */
export interface TrackImportResult {
  success: boolean
  track?: TrackWithUserStatus
  error?: string
  errorType?: string
  trackId?: string
}

// ============================================================================
// ACTION RESULT TYPE GUARDS
// ============================================================================

/**
 * Error action result type
 */
export interface ErrorActionResult {
  status: 'error'
  message: string
}

/**
 * Success action result type
 */
export interface SuccessActionResult {
  status: 'success'
  message: string
}

/**
 * Union type for action results
 */
export type ActionResultUnion = ErrorActionResult | SuccessActionResult

/**
 * Type guard to check if object is ErrorActionResult
 * 
 * @param obj - The object to check
 * @returns True if the object is an ErrorActionResult
 */
export function isErrorActionResult(obj: unknown): obj is ErrorActionResult {
  return (
    isObject(obj) &&
    obj.status === 'error' &&
    isString(obj.message)
  )
}

/**
 * Type guard to check if object is SuccessActionResult
 * 
 * @param obj - The object to check
 * @returns True if the object is a SuccessActionResult
 */
export function isSuccessActionResult(obj: unknown): obj is SuccessActionResult {
  return (
    isObject(obj) &&
    obj.status === 'success' &&
    isString(obj.message)
  )
}
