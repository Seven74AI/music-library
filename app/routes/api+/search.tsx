/**
 * Global search API endpoint
 * Searches across tracks, albums, and artists using FTS5
 * 
 * Security:
 * - Input validation using Zod schemas
 * - SQL injection prevention via proper escaping
 * - DoS prevention via query length limits
 * - Rate limiting handled by Express middleware (1000 req/min for GET)
 * - No authentication required (public music library search)
 */

import { z } from 'zod'
import {
	validateSearchQuery,
	validateSearchLimit,
	validateSearchType,
	validateCursor,
} from '#app/utils/search-validation.server.ts'
import { searchAll } from '#app/utils/search.server.ts'
import { type Route } from './+types/search.ts'

export async function loader({ request }: Route.LoaderArgs) {
	try {
		const url = new URL(request.url)
		
		// Security: Validate and sanitize all input parameters
		const rawQuery = url.searchParams.get('q') || ''
		const query = validateSearchQuery(rawQuery)
		
		const rawType = url.searchParams.get('type') || 'all'
		const type = validateSearchType(rawType)
		
		const limitParam = url.searchParams.get('limit')
		const limit = validateSearchLimit(
			limitParam ? parseInt(limitParam, 10) : 20,
		)
		
		const rawCursor = url.searchParams.get('cursor')
		const cursor = validateCursor(rawCursor)
		
		// Enable prefix matching by default for better search experience
		const usePrefix = url.searchParams.get('prefix') !== 'false'

		// Security: All inputs are now validated, safe to use
		const results = await searchAll(query, limit, cursor, type, usePrefix)
		return Response.json(results)
	} catch (error) {
		// Security: Don't expose internal error details to clients
		if (error instanceof z.ZodError) {
			return Response.json(
				{ error: 'Invalid search parameters', details: error.errors },
				{ status: 400 },
			)
		}
		
		console.error('Error searching:', error)
		return Response.json(
			{ error: 'Failed to perform search' },
			{ status: 500 },
		)
	}
}

