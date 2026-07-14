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

import { type z } from 'zod'
import {
	CursorSchema,
	SearchLimitSchema,
	SearchQuerySchema,
	SearchTypeSchema,
} from '#app/utils/search-validation.server.ts'
import { searchAll } from '#app/utils/search.server.ts'
import { type Route } from './+types/search.ts'

function invalidSearchParameters(error: z.ZodError) {
	return Response.json(
		{ error: 'Invalid search parameters', details: error.errors },
		{ status: 400 },
	)
}

export async function loader({ request, url }: Route.LoaderArgs) {
	

	const queryResult = SearchQuerySchema.safeParse(url.searchParams.get('q') ?? '')
	if (!queryResult.success) {
		return invalidSearchParameters(queryResult.error)
	}

	const typeResult = SearchTypeSchema.safeParse(url.searchParams.get('type') ?? 'all')
	if (!typeResult.success) {
		return invalidSearchParameters(typeResult.error)
	}

	const limitParam = url.searchParams.get('limit')
	const limitResult = SearchLimitSchema.safeParse(
		limitParam ? parseInt(limitParam, 10) : 20,
	)
	if (!limitResult.success) {
		return invalidSearchParameters(limitResult.error)
	}

	const rawCursor = url.searchParams.get('cursor')
	const cursorResult = CursorSchema.safeParse(
		rawCursor === null ? undefined : rawCursor,
	)
	if (!cursorResult.success) {
		return invalidSearchParameters(cursorResult.error)
	}

	const usePrefix = url.searchParams.get('prefix') !== 'false'

	try {
		const results = await searchAll(
			queryResult.data,
			limitResult.data,
			cursorResult.data,
			typeResult.data,
			usePrefix,
		)
		return Response.json(results)
	} catch (error) {
		console.error('🚨 [SEARCH API] Unexpected error searching:', error)
		if (error instanceof Error) {
			console.error('🚨 [SEARCH API] Error stack:', error.stack)
		}
		return Response.json(
			{ error: 'Failed to perform search' },
			{ status: 500 },
		)
	}
}

