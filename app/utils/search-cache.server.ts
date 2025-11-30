/**
 * Caching utilities for search results
 * Uses Epic Stack's cachified utility for efficient caching
 */

import { type SearchResponse } from '#app/types/search.ts'
import { cache, cachified } from '#app/utils/cache.server.ts'
import { searchAll } from './search.server.ts'

/**
 * Search with caching
 * Caches search results for 5 minutes to improve performance
 */
export async function searchWithCache(
	query: string,
	limit: number = 20,
	cursor?: string,
	type?: 'all' | 'tracks' | 'albums' | 'artists',
	usePrefix: boolean = false,
): Promise<SearchResponse> {
	const cacheKey = `search:${type || 'all'}:${query}:${limit}:${cursor || 'none'}:${usePrefix ? 'prefix' : 'full'}`

	return cachified({
		key: cacheKey,
		cache,
		ttl: 5 * 60 * 1000, // 5 minutes
		getFreshValue: () => searchAll(query, limit, cursor, type, usePrefix),
	})
}

