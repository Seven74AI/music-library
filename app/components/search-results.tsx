/**
 * Search results component for displaying unified search results
 */

import { Link } from 'react-router'
import  { type SearchResult } from '#app/types/search.ts'
import { Icon } from './ui/icon.tsx'

interface SearchResultsProps {
	results: SearchResult[]
	query: string
	onLoadMore?: () => void
	hasNext?: boolean
	isLoading?: boolean
}

export function SearchResults({
	results,
	query,
	onLoadMore,
	hasNext = false,
	isLoading = false,
}: SearchResultsProps) {
	// Only show "no results" message if there's an actual query
	if (results.length === 0 && !isLoading && query.trim()) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<Icon name="magnifying-glass" className="h-12 w-12 text-muted-foreground mb-4" />
				<h3 className="text-lg font-semibold mb-2">No results found</h3>
				<p className="text-muted-foreground">
					No tracks, albums, or artists match "{query}"
				</p>
			</div>
		)
	}

	// If no query, don't show anything (empty state is handled by parent)
	if (!query.trim() && results.length === 0) {
		return null
	}

	// Group results by type
	const tracks = results.filter((r) => r.type === 'track')
	const albums = results.filter((r) => r.type === 'album')
	const artists = results.filter((r) => r.type === 'artist')

	return (
		<div className="space-y-8">
			{/* Tracks Section */}
			{tracks.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
						<Icon name="file-text" className="h-5 w-5" />
						Tracks ({tracks.length})
					</h2>
					<div className="space-y-2">
						{tracks.map((result) => {
							if (result.type !== 'track') return null
							return (
								<Link
									key={result.id}
									to={`/library/${result.id}`}
									className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors"
								>
									<div className="flex-1 min-w-0">
										<p className="font-medium truncate">{result.title}</p>
										<p className="text-sm text-muted-foreground truncate">
											{result.artistName}
											{result.albumName && ` • ${result.albumName}`}
										</p>
									</div>
									{result.duration && (
										<span className="text-xs text-muted-foreground">
											{Math.floor(result.duration / 60)}:
											{String(result.duration % 60).padStart(2, '0')}
										</span>
									)}
								</Link>
							)
						})}
					</div>
				</div>
			)}

			{/* Albums Section */}
			{albums.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
						<Icon name="file-text" className="h-5 w-5" />
						Albums ({albums.length})
					</h2>
					<div className="space-y-2">
						{albums.map((result) => {
							if (result.type !== 'album') return null
							return (
								<Link
									key={result.id}
									to={`/library?album=${result.id}`}
									className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors"
								>
									<div className="flex-1 min-w-0">
										<p className="font-medium truncate">{result.name}</p>
										<p className="text-sm text-muted-foreground truncate">
											{result.artistName}
											{result.year && ` • ${result.year}`}
										</p>
									</div>
								</Link>
							)
						})}
					</div>
				</div>
			)}

			{/* Artists Section */}
			{artists.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
						<Icon name="file-text" className="h-5 w-5" />
						Artists ({artists.length})
					</h2>
					<div className="space-y-2">
						{artists.map((result) => {
							if (result.type !== 'artist') return null
							return (
								<Link
									key={result.id}
									to={`/library?artist=${result.id}`}
									className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors"
								>
									<div className="flex-1 min-w-0">
										<p className="font-medium truncate">{result.name}</p>
										{result.genre && (
											<p className="text-sm text-muted-foreground truncate">
												{result.genre}
											</p>
										)}
									</div>
								</Link>
							)
						})}
					</div>
				</div>
			)}

			{/* Load More Button */}
			{hasNext && onLoadMore && (
				<div className="flex justify-center pt-4">
					<button
						onClick={onLoadMore}
						disabled={isLoading}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
					>
						{isLoading ? 'Loading...' : 'Load More'}
					</button>
				</div>
			)}
		</div>
	)
}

