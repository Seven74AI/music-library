/**
 * Reusable Error Handlers
 * 
 * This file provides reusable error handling utilities to reduce code duplication
 * across route loaders and actions.
 * 
 * @example
 * ```typescript
 * import { handleServiceError, handleLoaderError } from '#app/utils/error-handlers.server'
 * 
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   try {
 *     const data = await someService.getData()
 *     return data({ data })
 *   } catch (error) {
 *     return handleLoaderError(error, { data: [] })
 *   }
 * }
 * ```
 */

import { data } from 'react-router'

/**
 * Standard error handler for route loaders
 * Logs the error and returns a fallback data structure
 * 
 * @param error - The error that occurred
 * @param fallback - Fallback data to return on error
 * @param context - Optional context for logging (e.g., 'YouTube playlists')
 * @returns Data response with fallback values
 */
export function handleLoaderError<T>(
  error: unknown, 
  fallback: T, 
  context?: string
): ReturnType<typeof data<T>> {
  const contextMsg = context ? `Error loading ${context}:` : 'Error in loader:'
  console.error(contextMsg, error)
  
  return data(fallback)
}

/**
 * Standard error handler for route actions
 * Logs the error and returns an error response
 * 
 * @param error - The error that occurred
 * @param context - Optional context for logging (e.g., 'playlist sync')
 * @param statusCode - HTTP status code to return (default: 500)
 * @returns Data response with error information
 */
export function handleActionError(
  error: unknown, 
  context?: string, 
  statusCode: number = 500
): ReturnType<typeof data<{ error: string }>> {
  const contextMsg = context ? `Error in ${context}:` : 'Error in action:'
  console.error(contextMsg, error)
  
  const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
  
  return data(
    { error: errorMessage }, 
    { status: statusCode }
  )
}

/**
 * Standard error handler for service operations
 * Logs the error and returns a standardized error response
 * 
 * @param error - The error that occurred
 * @param operation - The operation that failed (e.g., 'getPlaylists')
 * @param service - The service name (e.g., 'YouTube')
 * @returns Standardized error response
 */
export function handleServiceError(
  error: unknown, 
  operation: string, 
  service: string = 'Service'
): { success: false; error: string } {
  console.error(`${service} ${operation} error:`, error)
  
  const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
  
  return {
    success: false,
    error: errorMessage
  }
}

/**
 * Async error handler wrapper for service methods
 * Wraps async service methods with consistent error handling
 * 
 * @param serviceMethod - The async service method to wrap
 * @param operation - The operation name for logging
 * @param service - The service name for logging
 * @returns Wrapped method with error handling
 */
export function withServiceErrorHandler<T extends (...args: any[]) => Promise<any>>(
  serviceMethod: T,
  operation: string,
  service: string = 'Service'
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await serviceMethod(...args)
    } catch (error) {
      throw new Error(`${service} ${operation} failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }) as T
}

/**
 * Validation error handler for form actions
 * Handles validation errors and returns appropriate form response
 * 
 * @param error - The validation error
 * @param field - The field that failed validation
 * @returns Form error response
 */
export function handleValidationError(
  error: unknown, 
  field: string
): ReturnType<typeof data<{ error: string; field: string }>> {
  const errorMessage = error instanceof Error ? error.message : 'Invalid input'
  
  return data(
    { error: errorMessage, field }, 
    { status: 400 }
  )
}
