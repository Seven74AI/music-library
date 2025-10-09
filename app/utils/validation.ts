import { type z } from 'zod'

/**
 * Validation Utilities for Type Safety
 * 
 * This file provides utilities for validating external API data with Zod schemas.
 * Database operations use Prisma types directly for type safety.
 * 
 * @example
 * ```typescript
 * const validatedData = validateYouTubeAPIResponse(
 *   rawApiResponse,
 *   YouTubePlaylistSchema
 * )
 * ```
 * 
 * @see {@link ../types/youtube-api.ts} for YouTube API schemas
 * @see {@link https://www.prisma.io/docs/reference/api-reference/prisma-client-reference} for Prisma types
 */

export class ValidationError extends Error {
  constructor(message: string, public readonly errors: z.ZodError) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validate YouTube API response with Zod schema
 * Throws ValidationError if validation fails
 * 
 * @param data - Raw API response data
 * @param schema - Zod schema to validate against
 * @returns Validated and type-safe data
 * @throws ValidationError if validation fails
 */
export function validateYouTubeAPIResponse<T>(
  data: unknown, 
  schema: z.ZodSchema<T>
): T {
  const result = schema.safeParse(data)
  
  if (!result.success) {
    throw new ValidationError(
      `YouTube API response validation failed: ${result.error.message}`,
      result.error
    )
  }
  
  return result.data
}

// Database validation removed - use Prisma types directly
// Prisma handles database-level validation and type safety

/**
 * Safe validation that returns result object instead of throwing
 * 
 * @param data - Raw data to validate
 * @param schema - Zod schema to validate against
 * @returns Result object with success/error information
 */
export function safeValidate<T>(
  data: unknown, 
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data)
  
  if (!result.success) {
    return {
      success: false,
      error: `Validation failed: ${result.error.message}`
    }
  }
  
  return {
    success: true,
    data: result.data
  }
}
