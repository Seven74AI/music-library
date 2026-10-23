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

import { data } from "react-router";

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
  context?: string,
): ReturnType<typeof data<T>> {
  const contextMsg = context ? `Error loading ${context}:` : "Error in loader:";
  console.error(contextMsg, error);

  return data(fallback);
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
  service: string = "Service",
): { success: false; error: string } {
  console.error(`${service} ${operation} error:`, error);

  const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";

  return {
    success: false,
    error: errorMessage,
  };
}
