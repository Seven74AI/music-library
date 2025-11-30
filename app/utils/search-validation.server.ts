/**
 * Security validation for search queries
 * Prevents SQL injection, XSS, and DoS attacks
 */

import { z } from 'zod'

/**
 * Maximum query length to prevent DoS attacks
 * FTS5 queries can be expensive, so we limit query length
 */
const MAX_QUERY_LENGTH = 200

/**
 * Maximum number of words in a query to prevent complex queries
 */
const MAX_QUERY_WORDS = 20

/**
 * Valid cursor format: base64-encoded JSON string
 * Example: {"type":"track","id":"cmim4k3df000atq9kznolo68f","offset":20}
 */
const CURSOR_REGEX = /^[A-Za-z0-9+/=]+$/

/**
 * Search query validation schema
 * Validates and sanitizes user input for search queries
 */
export const SearchQuerySchema = z
	.string()
	.min(1, 'Query cannot be empty')
	.max(MAX_QUERY_LENGTH, `Query cannot exceed ${MAX_QUERY_LENGTH} characters`)
	.trim()
	.refine(
		(query) => {
			// Count words (split by whitespace)
			const words = query.split(/\s+/).filter((w) => w.length > 0)
			return words.length <= MAX_QUERY_WORDS
		},
		{
			message: `Query cannot exceed ${MAX_QUERY_WORDS} words`,
		},
	)
	.refine(
		(query) => {
			// Reject queries with only special characters (potential injection attempts)
			const hasAlphanumeric = /[a-zA-Z0-9]/.test(query)
			return hasAlphanumeric
		},
		{
			message: 'Query must contain at least one alphanumeric character',
		},
	)

/**
 * Search limit validation schema
 */
export const SearchLimitSchema = z
	.number()
	.int()
	.min(1, 'Limit must be at least 1')
	.max(100, 'Limit cannot exceed 100')

/**
 * Search type validation schema
 */
export const SearchTypeSchema = z.enum(['all', 'tracks', 'albums', 'artists'])

/**
 * Cursor validation schema
 */
export const CursorSchema = z
	.string()
	.optional()
	.refine(
		(cursor) => {
			if (!cursor) return true
			// Validate base64 format
			if (!CURSOR_REGEX.test(cursor)) return false
			try {
				// Try to decode and parse as JSON
				const decoded = Buffer.from(cursor, 'base64').toString('utf-8')
				const parsed = JSON.parse(decoded) as unknown
				// Validate structure
				return (
					typeof parsed === 'object' &&
					parsed !== null &&
					'id' in parsed &&
					typeof (parsed as { id: unknown }).id === 'string' &&
					(parsed as { id: string }).id.length > 0
				)
			} catch {
				return false
			}
		},
		{
			message: 'Invalid cursor format',
		},
	)

/**
 * Validate and sanitize search query
 * @throws z.ZodError if validation fails
 */
export function validateSearchQuery(query: unknown): string {
	return SearchQuerySchema.parse(query)
}

/**
 * Validate search limit
 * @throws z.ZodError if validation fails
 */
export function validateSearchLimit(limit: unknown): number {
	return SearchLimitSchema.parse(limit)
}

/**
 * Validate search type
 * @throws z.ZodError if validation fails
 */
export function validateSearchType(type: unknown): 'all' | 'tracks' | 'albums' | 'artists' {
	return SearchTypeSchema.parse(type)
}

/**
 * Validate cursor
 * @throws z.ZodError if validation fails
 */
export function validateCursor(cursor: unknown): string | undefined {
	return CursorSchema.parse(cursor)
}

