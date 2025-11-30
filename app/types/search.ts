/**
 * Search result types and interfaces for global search functionality
 */

export type SearchResultType = 'track' | 'album' | 'artist'

export interface BaseSearchResult {
	id: string
	type: SearchResultType
	relevance: number
}

export interface TrackSearchResult extends BaseSearchResult {
	type: 'track'
	title: string
	artistName: string
	albumName?: string | null
	artistId: string
	albumId?: string | null
	duration?: number | null
	coverImageId?: string | null
	serviceId?: string | null
}

export interface AlbumSearchResult extends BaseSearchResult {
	type: 'album'
	name: string
	artistName: string
	artistId: string
	year?: number | null
	coverImageId?: string | null
}

export interface ArtistSearchResult extends BaseSearchResult {
	type: 'artist'
	name: string
	genre?: string | null
}

export type SearchResult =
	| TrackSearchResult
	| AlbumSearchResult
	| ArtistSearchResult

export interface SearchResponse {
	results: SearchResult[]
	pagination: {
		limit: number
		hasNext: boolean
		nextCursor: string | null
	}
}

