/**
 * Global search page for tracks, albums, and artists
 */

import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { SearchBar } from '#app/components/search-bar.tsx'
import { SearchResults } from '#app/components/search-results.tsx'
import { useDelayedIsPending } from '#app/utils/misc.tsx'
import {
	validateSearchQuery,
	validateSearchLimit,
	validateSearchType,
	validateCursor,
} from '#app/utils/search-validation.server.ts'
import { searchAll } from '#app/utils/search.server.ts'
import { type Route } from './+types/search.ts'

/**
 * Global search page for tracks, albums, and artists
 * 
 * Security:
 * - Input validation using Zod schemas
 * - SQL injection prevention via proper escaping
 * - DoS prevention via query length limits
 * - XSS protection via React's automatic escaping
 */
export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	
	try {
		// Security: Validate and sanitize all input parameters
		const rawQuery = url.searchParams.get('q') || ''
		const query = rawQuery.trim() ? validateSearchQuery(rawQuery) : ''
		
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

		if (!query) {
			return {
				results: [],
				query: '',
				type,
				pagination: { limit, hasNext: false, nextCursor: null },
			}
		}

		// Security: All inputs are now validated, safe to use
		const searchResults = await searchAll(query, limit, cursor, type, usePrefix)
		return {
			results: searchResults.results,
			query,
			type,
			pagination: searchResults.pagination,
		}
	} catch (error) {
		// Security: Don't expose internal error details to clients
		if (error instanceof z.ZodError) {
			// Validation error - return empty results
			return {
				results: [],
				query: url.searchParams.get('q') || '',
				type: 'all',
				pagination: { limit: 20, hasNext: false, nextCursor: null },
			}
		}
		
		console.error('Error in search loader:', error)
		return {
			results: [],
			query: url.searchParams.get('q') || '',
			type: 'all',
			pagination: { limit: 20, hasNext: false, nextCursor: null },
		}
	}
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
	const { results, query, pagination } = loaderData
	const [searchParams, setSearchParams] = useSearchParams()
	const isPending = useDelayedIsPending({
		formMethod: 'GET',
		formAction: '/search',
	})

	const status: 'idle' | 'pending' | 'success' | 'error' = isPending
		? 'pending'
		: results.length > 0
			? 'success'
			: query
				? 'idle'
				: 'idle'

	const handleLoadMore = () => {
		if (pagination.hasNext && pagination.nextCursor) {
			const newParams = new URLSearchParams(searchParams)
			newParams.set('cursor', pagination.nextCursor)
			setSearchParams(newParams)
		}
	}

	return (
		<div className="py-8">
			<div className="mb-8">
				<h1 className="text-3xl font-bold mb-2">Search</h1>
				<p className="text-muted-foreground">
					Search for tracks, albums, and artists in your music library
				</p>
			</div>

			<div className="mb-6">
				<SearchBar
					status={status}
					autoFocus
					autoSubmit
					action="/search"
					searchParamName="q"
					showTypeSelector
				/>
			</div>

			{query && (
				<div className="mb-4">
					<p className="text-sm text-muted-foreground">
						Found {results.length} result{results.length !== 1 ? 's' : ''} for "
						{query}"
					</p>
				</div>
			)}

			<SearchResults
				results={results}
				query={query}
				hasNext={pagination.hasNext}
				onLoadMore={handleLoadMore}
				isLoading={isPending}
			/>
		</div>
	)
}

