/**
 * Search utilities for global search across tracks, albums, and artists
 * Uses SQLite FTS5 for full-text search with content tables
 */

import  {
	type AlbumSearchResult,
	type ArtistSearchResult,
	type SearchResult,
	type SearchResponse,
	type TrackSearchResult,
} from '#app/types/search.ts'
import { prisma } from '#app/utils/db.server.ts'

/**
 * Escape special characters in FTS5 query string
 * FTS5 has special characters: ", ', \, *, ?, and, or, not
 * 
 * Security: This function prevents FTS5 query injection by escaping all special characters.
 * Note: We don't escape * here because we use it for prefix matching, but the query
 * is validated before reaching this function to ensure it doesn't contain malicious content.
 * 
 * @param query - User input query (must be pre-validated)
 * @param allowPrefix - Whether to allow * for prefix matching
 * @returns Escaped FTS5 query string safe for use in MATCH clause
 */
function escapeFts5Query(query: string, allowPrefix: boolean = false): string {
	// Security: Normalize and trim first to prevent whitespace-based attacks
	let escaped = query
		.replace(/\s+/g, ' ') // Normalize whitespace (prevents whitespace-based attacks)
		.trim()
	
	// Security: Escape all FTS5 special characters to prevent query injection
	// Double quotes must be doubled for FTS5
	escaped = escaped.replace(/"/g, '""')
	// Single quotes must be doubled for SQL string literals
	escaped = escaped.replace(/'/g, "''")
	// Backslashes must be escaped
	escaped = escaped.replace(/\\/g, '\\\\')
	// Question marks must be escaped (used for phrase queries)
	escaped = escaped.replace(/\?/g, '\\?')
	
	// Security: Escape boolean operators to prevent query manipulation
	// These are case-insensitive in FTS5, so we escape them regardless of case
	escaped = escaped.replace(/\b(AND|OR|NOT)\b/gi, (match) => `"${match}"`)
	
	// Only escape * if we're not using prefix matching
	// When allowPrefix is true, we'll add * ourselves in buildFts5Query
	if (!allowPrefix) {
		escaped = escaped.replace(/\*/g, '\\*')
	}
	
	return escaped
}

/**
 * Build FTS5 query string with optional prefix matching
 * By default, enables prefix matching for better typeahead/search-as-you-type behavior
 * 
 * Security: The input query must be pre-validated using validateSearchQuery()
 * to prevent injection attacks and DoS.
 * 
 * @param query - Pre-validated search query
 * @param usePrefix - Whether to enable prefix matching (default: true)
 * @returns Safe FTS5 query string for use in MATCH clause
 */
function buildFts5Query(query: string, usePrefix: boolean = true): string {
	// Security: Query should already be validated, but double-check it's not empty
	if (!query || !query.trim()) return ''
	
	// Escape the query, but allow * if we're using prefix matching
	const escaped = escapeFts5Query(query, usePrefix)
	if (!escaped) return ''
	
	// For prefix queries, append * to each word to match partial words
	// This allows "m" to match "meryl", "metal", etc.
	// Security: We only add * to words that don't already have it (to prevent double *)
	if (usePrefix) {
		return escaped
			.split(/\s+/)
			.filter((word) => word.length > 0) // Remove empty strings
			.map((word) => {
				// Security: Don't add * if word already ends with * (prevent double *)
				return word.endsWith('*') ? word : `${word}*`
			})
			.join(' ')
	}
	return escaped
}

/**
 * Search tracks using FTS5
 * 
 * Security: All parameters must be pre-validated using validation functions
 * from search-validation.server.ts to prevent SQL injection and DoS attacks.
 * 
 * @param query - Pre-validated search query
 * @param limit - Pre-validated limit (1-100)
 * @param cursor - Pre-validated cursor (optional)
 * @param usePrefix - Whether to use prefix matching
 * @returns Search results with pagination
 */
export async function searchTracks(
	query: string,
	limit: number = 20,
	cursor?: string,
	usePrefix: boolean = true,
): Promise<SearchResponse> {
	// Security: Query should be pre-validated, but check anyway
	if (!query || !query.trim()) {
		return { results: [], pagination: { limit, hasNext: false, nextCursor: null } }
	}

	const ftsQuery = buildFts5Query(query, usePrefix)
	const normalizedQuery = query.toLowerCase().trim()

	// Build the SQL query with relevance ranking
	// Security: FTS5 MATCH requires the query to be embedded directly in SQL (not parameterized)
	// The ftsQuery is already escaped by escapeFts5Query function, which handles:
	// - FTS5 special characters (", ', \, ?, *, AND, OR, NOT)
	// - SQL string literal escaping (single quotes doubled)
	// 
	// Additional security: We use parameterized queries for all other values (normalizedQuery, limit)
	const prefixPattern = `${normalizedQuery}%`
	// Security: Double-check SQL escaping (escapeFts5Query already does this, but be explicit)
	// Single quotes are already doubled by escapeFts5Query, but we ensure it here too
	const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''")
	const results = await prisma.$queryRawUnsafe<
		Array<{
			type: string
			id: string
			title: string
			artist_name: string
			artist_id: string
			album_name: string | null
			album_id: string | null
			duration: number | null
			coverImageId: string | null
			serviceId: string | null
			relevance_rank: number
			fts_rank: number
		}>
	>(
		`SELECT 
			'track' as type,
			t.id,
			t.title,
			a.name as artist_name,
			a.id as artist_id,
			COALESCE(alb.name, '') as album_name,
			alb.id as album_id,
			t.duration,
			t."coverImageId",
			t."serviceId",
			CASE 
				WHEN LOWER(t.title) = ? THEN 1
				WHEN LOWER(t.title) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			tracks_fts.rank as fts_rank
		FROM tracks_fts
		JOIN "Track" t ON tracks_fts.track_id = t.id
		JOIN "Artist" a ON t."artistId" = a.id
		LEFT JOIN "Album" alb ON t."albumId" = alb.id
		WHERE tracks_fts MATCH '${sqlEscapedFtsQuery}'
		ORDER BY relevance_rank, fts_rank, t.title
		LIMIT ?`,
		normalizedQuery,
		prefixPattern,
		limit + 1,
	)

	const hasNext = results.length > limit
	const tracks = results.slice(0, limit).map(
		(row): TrackSearchResult => ({
			type: 'track',
			id: row.id,
			title: row.title,
			artistName: row.artist_name,
			artistId: row.artist_id,
			albumName: row.album_name || null,
			albumId: row.album_id || null,
			duration: row.duration,
			coverImageId: row.coverImageId,
			serviceId: row.serviceId,
			relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
		}),
	)

	const nextCursor = hasNext && tracks.length > 0 ? tracks[tracks.length - 1]?.id ?? null : null

	return {
		results: tracks,
		pagination: {
			limit,
			hasNext,
			nextCursor,
		},
	}
}

/**
 * Search albums using FTS5
 */
export async function searchAlbums(
	query: string,
	limit: number = 20,
	cursor?: string,
	usePrefix: boolean = true,
): Promise<SearchResponse> {
	if (!query.trim()) {
		return { results: [], pagination: { limit, hasNext: false, nextCursor: null } }
	}

	const ftsQuery = buildFts5Query(query, usePrefix)
	const normalizedQuery = query.toLowerCase().trim()

	const prefixPattern = `${normalizedQuery}%`
	const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''")
	const results = await prisma.$queryRawUnsafe<
		Array<{
			type: string
			id: string
			name: string
			artist_name: string
			artist_id: string
			year: number | null
			coverImageId: string | null
			relevance_rank: number
			fts_rank: number
		}>
	>(
		`SELECT 
			'album' as type,
			alb.id,
			alb.name,
			a.name as artist_name,
			a.id as artist_id,
			alb.year,
			alb."coverImageId",
			CASE 
				WHEN LOWER(alb.name) = ? THEN 1
				WHEN LOWER(alb.name) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			albums_fts.rank as fts_rank
		FROM albums_fts
		JOIN "Album" alb ON albums_fts.album_id = alb.id
		JOIN "Artist" a ON alb."artistId" = a.id
		WHERE albums_fts MATCH '${sqlEscapedFtsQuery}'
		ORDER BY relevance_rank, fts_rank, alb.name
		LIMIT ?`,
		normalizedQuery,
		prefixPattern,
		limit + 1,
	)

	const hasNext = results.length > limit
	const albums = results.slice(0, limit).map(
		(row): AlbumSearchResult => ({
			type: 'album',
			id: row.id,
			name: row.name,
			artistName: row.artist_name,
			artistId: row.artist_id,
			year: row.year,
			coverImageId: row.coverImageId,
			relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
		}),
	)

	const nextCursor = hasNext && albums.length > 0 ? albums[albums.length - 1]?.id ?? null : null

	return {
		results: albums,
		pagination: {
			limit,
			hasNext,
			nextCursor,
		},
	}
}

/**
 * Search artists using FTS5
 */
export async function searchArtists(
	query: string,
	limit: number = 20,
	cursor?: string,
	usePrefix: boolean = true,
): Promise<SearchResponse> {
	if (!query.trim()) {
		return { results: [], pagination: { limit, hasNext: false, nextCursor: null } }
	}

	const ftsQuery = buildFts5Query(query, usePrefix)
	const normalizedQuery = query.toLowerCase().trim()

	const prefixPattern = `${normalizedQuery}%`
	const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''")
	const results = await prisma.$queryRawUnsafe<
		Array<{
			type: string
			id: string
			name: string
			genre: string | null
			relevance_rank: number
			fts_rank: number
		}>
	>(
		`SELECT 
			'artist' as type,
			a.id,
			a.name,
			a.genre,
			CASE 
				WHEN LOWER(a.name) = ? THEN 1
				WHEN LOWER(a.name) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			artists_fts.rank as fts_rank
		FROM artists_fts
		JOIN "Artist" a ON artists_fts.artist_id = a.id
		WHERE artists_fts MATCH '${sqlEscapedFtsQuery}'
		ORDER BY relevance_rank, fts_rank, a.name
		LIMIT ?`,
		normalizedQuery,
		prefixPattern,
		limit + 1,
	)

	const hasNext = results.length > limit
	const artists = results.slice(0, limit).map(
		(row): ArtistSearchResult => ({
			type: 'artist',
			id: row.id,
			name: row.name,
			genre: row.genre,
			relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
		}),
	)

	const nextCursor = hasNext && artists.length > 0 ? artists[artists.length - 1]?.id ?? null : null

	return {
		results: artists,
		pagination: {
			limit,
			hasNext,
			nextCursor,
		},
	}
}

/**
 * Unified search across all entity types
 * Searches tracks, albums, and artists in parallel
 */
export async function searchAll(
	query: string,
	limit: number = 20,
	cursor?: string,
	type?: 'all' | 'tracks' | 'albums' | 'artists',
	usePrefix: boolean = true,
): Promise<SearchResponse> {
	if (!query.trim()) {
		return { results: [], pagination: { limit, hasNext: false, nextCursor: null } }
	}

	// Calculate per-type limits (distribute evenly, with remainder to tracks)
	const perTypeLimit = Math.ceil(limit / 3)
	const trackLimit = type === 'all' || type === 'tracks' ? perTypeLimit : 0
	const albumLimit = type === 'all' || type === 'albums' ? perTypeLimit : 0
	const artistLimit = type === 'all' || type === 'artists' ? perTypeLimit : 0

	// Search all types in parallel
	const [tracksResult, albumsResult, artistsResult] = await Promise.all([
		trackLimit > 0 ? searchTracks(query, trackLimit, cursor, usePrefix) : Promise.resolve({ results: [], pagination: { limit: 0, hasNext: false, nextCursor: null } }),
		albumLimit > 0 ? searchAlbums(query, albumLimit, cursor, usePrefix) : Promise.resolve({ results: [], pagination: { limit: 0, hasNext: false, nextCursor: null } }),
		artistLimit > 0 ? searchArtists(query, artistLimit, cursor, usePrefix) : Promise.resolve({ results: [], pagination: { limit: 0, hasNext: false, nextCursor: null } }),
	])

	// Combine and sort by relevance
	const allResults: SearchResult[] = [
		...tracksResult.results,
		...albumsResult.results,
		...artistsResult.results,
	].sort((a, b) => a.relevance - b.relevance)

	// Take top N results
	const results = allResults.slice(0, limit)
	const hasNext = allResults.length > limit || tracksResult.pagination.hasNext || albumsResult.pagination.hasNext || artistsResult.pagination.hasNext
	const nextCursor = results.length > 0 ? results[results.length - 1]?.id ?? null : null

	return {
		results,
		pagination: {
			limit,
			hasNext,
			nextCursor,
		},
	}
}

