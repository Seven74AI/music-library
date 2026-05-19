import { useState, useMemo } from 'react'
import {
  data,
  Form,
  useActionData,
  useLoaderData,
  Link,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from 'react-router'

import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Button } from '#app/components/ui/button'
import { Card, CardContent } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { Input } from '#app/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#app/components/ui/select'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { isErrorActionResult, isSuccessActionResult, isYouTubePlaylistDisplay } from '#app/types/frontend'
import { 
  YOUTUBE_PLAYLIST_DISCOVERY_INTENTS,
  YOUTUBE_PAGE_TYPES,
  validatePlaylistDiscoveryIntent,
  getIntentErrorMessage,
} from '#app/types/youtube-intents'
import { requireUserId } from '#app/utils/auth.server'
import { handleLoaderError } from '#app/utils/error-handlers.server'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'

export const handle: BreadcrumbHandle = {
	breadcrumb: <Icon name="file-text">Playlists</Icon>,
}

/**
 * Loader function for YouTube playlists discovery page
 * Fetches user's YouTube playlists with sync status
 * 
 * @param request - The incoming request
 * @returns Promise resolving to playlists data and connection status
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const servicePlaylistService = createServicePlaylistService()
	
	try {
		const result = await servicePlaylistService.getAllPlaylistsWithSyncStatus('youtube', userId)
		
		return data({
			playlists: result.playlists,
			hasConnection: result.hasConnection,
			service: result.service,
		})
	} catch (error) {
		return handleLoaderError(error, {
			playlists: [],
			hasConnection: false,
			service: null,
		}, 'YouTube playlists')
	}
}

/**
 * Validation helper for playlist ID
 * 
 * @param playlistId - The playlist ID to validate
 * @returns True if the playlist ID is a valid non-empty string
 */
function validatePlaylistId(playlistId: unknown): playlistId is string {
	return typeof playlistId === 'string' && playlistId.length > 0
}

/**
 * Action function for YouTube playlists discovery page
 * Handles adding/removing playlists from sync
 * 
 * @param request - The incoming request with form data
 * @returns Promise resolving to action result
 */
export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	
	const intent = formData.get('intent')
	
	if (!validatePlaylistDiscoveryIntent(intent)) {
		return data({ status: 'error', message: getIntentErrorMessage(YOUTUBE_PAGE_TYPES.DISCOVERY) }, { status: 400 })
	}

	const servicePlaylistService = createServicePlaylistService()

	try {
		switch (intent) {
			case YOUTUBE_PLAYLIST_DISCOVERY_INTENTS.ADD_TO_SYNC: {
				const playlistId = formData.get('playlistId')
				if (!validatePlaylistId(playlistId)) {
					return data({ status: 'error', message: 'Valid playlist ID is required' }, { status: 400 })
				}
				
				const result = await servicePlaylistService.addPlaylistToSync('youtube', playlistId, userId)
				if (result.success) {
					// Serialize pendingMatches to ensure all nested objects are properly converted
					const serializedPendingMatches = result.pendingMatches?.map(match => ({
						deletedVideo: match.deletedVideo,
						candidateTracks: match.candidateTracks.map(track => ({
							...track,
							artist: typeof track.artist === 'object' && track.artist !== null && 'name' in track.artist
								? (track.artist as { name: string }).name || 'Unknown Artist'
								: (typeof track.artist === 'string' ? track.artist : 'Unknown Artist')
						}))
					})) || []
					
					return data({ 
						status: 'success', 
						playlistId: result.playlistId,
						tracksAdded: result.tracksAdded,
						totalTracks: result.totalTracks,
						pendingMatches: serializedPendingMatches,
						message: result.message
					})
				} else {
					return data({ 
						status: 'error', 
						message: result.message || result.error || 'Failed to sync playlist. Please try again.' 
					}, { status: 500 })
				}
			}
			
			case YOUTUBE_PLAYLIST_DISCOVERY_INTENTS.REMOVE_FROM_SYNC: {
				const playlistId = formData.get('playlistId')
				if (!validatePlaylistId(playlistId)) {
					return data({ status: 'error', message: 'Valid playlist ID is required' }, { status: 400 })
				}
				
				const result = await servicePlaylistService.removePlaylistFromSync(YOUTUBE_SERVICE.NAME, playlistId, userId)
				console.error('playlistId', playlistId)
				return data({ status: 'success', ...result })
			}
			
			default:
				return data({ status: 'error', message: 'Invalid action' })
		}
	} catch (error) {
		console.error('Error in YouTube playlists action:', error)
		return data({
			status: 'error',
			message: error instanceof Error ? error.message : 'An error occurred',
		})
	}
}

type SortOption = 
	| 'title-asc'
	| 'title-desc'
	| 'tracks-asc'
	| 'tracks-desc'
	| 'channel-asc'
	| 'channel-desc'
	| 'synced-first'
	| 'not-synced-first'

export default function YouTubePlaylistsPage() {
	const loaderData = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	// Validate loader data with type guards
	if (!Array.isArray(loaderData.playlists) || !loaderData.playlists.every(isYouTubePlaylistDisplay)) {
		throw new Error('Invalid playlists data received from server')
	}

	if (typeof loaderData.hasConnection !== 'boolean') {
		throw new Error('Invalid hasConnection data received from server')
	}

	const { playlists, hasConnection } = loaderData
	const typedPlaylists = playlists

	// Search and sort state
	const [searchQuery, setSearchQuery] = useState('')
	const [sortOption, setSortOption] = useState<SortOption>('title-asc')

	// Filter and sort playlists
	const filteredAndSortedPlaylists = useMemo(() => {
		let filtered = typedPlaylists

		// Apply search filter
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase().trim()
			filtered = typedPlaylists.filter((playlist) => {
				const title = playlist.snippet?.title?.toLowerCase() || ''
				const description = playlist.snippet?.description?.toLowerCase() || ''
				const channel = playlist.snippet?.channelTitle?.toLowerCase() || ''
				return title.includes(query) || description.includes(query) || channel.includes(query)
			})
		}

		// Apply sorting
		const sorted = [...filtered].sort((a, b) => {
			switch (sortOption) {
				case 'title-asc':
					return (a.snippet?.title || '').localeCompare(b.snippet?.title || '')
				case 'title-desc':
					return (b.snippet?.title || '').localeCompare(a.snippet?.title || '')
				case 'tracks-asc':
					return (a.contentDetails?.itemCount || 0) - (b.contentDetails?.itemCount || 0)
				case 'tracks-desc':
					return (b.contentDetails?.itemCount || 0) - (a.contentDetails?.itemCount || 0)
				case 'channel-asc':
					return (a.snippet?.channelTitle || '').localeCompare(b.snippet?.channelTitle || '')
				case 'channel-desc':
					return (b.snippet?.channelTitle || '').localeCompare(a.snippet?.channelTitle || '')
				case 'synced-first':
					if (a.isSynced === b.isSynced) {
						return (a.snippet?.title || '').localeCompare(b.snippet?.title || '')
					}
					return a.isSynced ? -1 : 1
				case 'not-synced-first':
					if (a.isSynced === b.isSynced) {
						return (a.snippet?.title || '').localeCompare(b.snippet?.title || '')
					}
					return a.isSynced ? 1 : -1
				default:
					return 0
			}
		})

		return sorted
	}, [typedPlaylists, searchQuery, sortOption])

	return (
		<div className="py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services/youtube">
							<Icon name="arrow-left" className="mr-2" />
							Back
						</Link>
					</Button>
				</div>
				<div className="flex items-center gap-4">
					<img 
						src="/logos/youtube.svg" 
						alt="YouTube logo"
						className="w-8 h-8"
					/>
					<div>
						<h1 className="text-3xl font-bold">YouTube Playlists</h1>
						<p className="text-muted-foreground mt-1">
							Discover and sync your YouTube playlists
						</p>
					</div>
				</div>
			</div>

			{/* Connection Status */}
			{!hasConnection && (
				<Card className="mb-6">
					<CardContent className="text-center py-8">
						<Icon name="link-2" className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-lg font-semibold mb-2">Not Connected to YouTube</h3>
						<p className="text-muted-foreground mb-4">
							Connect your YouTube account to discover and sync your playlists.
						</p>
						<Button asChild>
							<Link to="/music/services/youtube/auth">
								<Icon name="link-2" className="h-4 w-4 mr-2" />
								Connect YouTube Account
							</Link>
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Navigation */}
			{hasConnection && (
				<div className="mb-6">
					<Button asChild variant="outline">
						<Link to="/music/services/youtube/synced-playlists">
							<Icon name="file-text" className="h-4 w-4 mr-2" />
							View Synced Playlists
						</Link>
					</Button>
				</div>
			)}

			{/* Action Messages */}
			{actionData?.status === 'error' && (
				<div className="mb-6 rounded-md bg-destructive/15 p-4">
					<div className="flex items-center gap-2">
						<Icon name="question-mark-circled" className="h-4 w-4 text-destructive" />
						<p className="text-sm text-destructive font-medium">Error</p>
					</div>
					<p className="text-sm text-destructive mt-1">{isErrorActionResult(actionData) ? actionData.message : 'An error occurred'}</p>
				</div>
			)}

			{actionData?.status === 'success' && (
		<div className="mb-6 rounded-md bg-green-50 dark:bg-green-950 p-4">
				<div className="flex items-center gap-2">
					<Icon name="check-circled" className="h-4 w-4 text-green-600 dark:text-green-400" />
					<p className="text-sm text-green-800 dark:text-green-200 font-medium">Success</p>
				</div>
				<p className="text-sm text-green-700 dark:text-green-300 mt-1">{isSuccessActionResult(actionData) ? actionData.message : 'Playlist synced successfully'}</p>
				</div>
			)}

			{/* Playlists List */}
			{hasConnection && typedPlaylists.length > 0 && (
				<div className="bg-card rounded-lg border border-border p-6">
					<div className="mb-6">
						<h1 className="mb-2">Your YouTube Playlists</h1>
						<p className="text-muted-foreground">Choose which playlists to sync to your music library</p>
					</div>

					{/* Search and Sort Controls */}
					<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex-1 max-w-md">
							<div className="relative">
								<Icon 
									name="magnifying-glass" 
									className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									type="search"
									placeholder="Search playlists..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="pl-9"
								/>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<label htmlFor="sort-select" className="text-sm text-muted-foreground whitespace-nowrap">
								Sort by:
							</label>
							<Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
								<SelectTrigger id="sort-select" className="w-[180px]">
									<SelectValue placeholder="Sort by..." />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="title-asc">Title (A-Z)</SelectItem>
									<SelectItem value="title-desc">Title (Z-A)</SelectItem>
									<SelectItem value="tracks-desc">Tracks (Most)</SelectItem>
									<SelectItem value="tracks-asc">Tracks (Least)</SelectItem>
									<SelectItem value="channel-asc">Channel (A-Z)</SelectItem>
									<SelectItem value="channel-desc">Channel (Z-A)</SelectItem>
									<SelectItem value="synced-first">Synced First</SelectItem>
									<SelectItem value="not-synced-first">Not Synced First</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Results count */}
					{searchQuery && (
						<div className="mb-4 text-sm text-muted-foreground">
							Found {filteredAndSortedPlaylists.length} of {typedPlaylists.length} playlists
						</div>
					)}

					{/* No results message */}
					{filteredAndSortedPlaylists.length === 0 ? (
						<div className="text-center py-12">
							<Icon name="magnifying-glass" className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
							<p className="text-muted-foreground">
								No playlists found matching "{searchQuery}"
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-4"
								onClick={() => setSearchQuery('')}
							>
								Clear search
							</Button>
						</div>
					) : (
						<div className="border border-border rounded-lg overflow-hidden">
							{/* Table Header */}
							<div className="grid grid-cols-[1fr_auto_auto] md:grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-6 py-3 bg-muted/30 border-b border-border">
								<div>Playlist</div>
								<div className="w-32 text-center hidden md:block">Channel</div>
								<div className="w-20 text-center">Tracks</div>
								<div className="w-24 text-center hidden sm:block">Status</div>
								<div className="w-40 text-center">Actions</div>
							</div>

							{/* Table Body */}
							<div>
								{filteredAndSortedPlaylists.map((playlist) => (
									<div 
										key={playlist.id} 
										className="grid grid-cols-[1fr_auto_auto] md:grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-6 py-4 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
									>
										{/* Playlist Info */}
										<div className="flex items-center gap-3 min-w-0">
											{playlist.snippet?.thumbnails?.default?.url ? (
												<img 
													src={playlist.snippet.thumbnails.default.url} 
													alt={playlist.snippet.title}
													className="w-12 h-12 rounded object-cover flex-shrink-0"
												/>
											) : (
												<div className="w-12 h-12 bg-muted rounded flex items-center justify-center flex-shrink-0">
													<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
												</div>
											)}
											<div className="min-w-0 flex-1">
												<div className="truncate">{playlist.snippet?.title || 'Unknown Title'}</div>
												<div className="text-muted-foreground truncate">{playlist.snippet?.description || 'No description'}</div>
												<div className="text-muted-foreground truncate md:hidden mt-1">
													{playlist.snippet?.channelTitle || 'Unknown Channel'}
												</div>
											</div>
										</div>

										{/* Channel */}
										<div className="w-32 flex flex-col items-center justify-center text-center hidden md:flex">
											<div className="truncate w-full">{playlist.snippet?.channelTitle || 'Unknown Channel'}</div>
											<div className="text-muted-foreground truncate w-full">
												({playlist.snippet?.channelTitle?.replace(/\s+/g, '') || 'UnknownChannel'})
											</div>
										</div>

										{/* Tracks */}
										<div className="w-20 flex items-center justify-center">
											{playlist.contentDetails?.itemCount || 0}
										</div>

										{/* Status */}
										<div className="w-24 flex items-center justify-center hidden sm:flex">
											{playlist.isSynced ? (
												<span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
													Synced
												</span>
											) : (
												<span className="px-2 py-1 rounded-md bg-muted text-muted-foreground whitespace-nowrap">
													Not Synced
												</span>
											)}
										</div>

										{/* Actions */}
										<div className="w-40 flex items-center justify-center gap-2">
											{/* Link to YouTube */}
											<button
												onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.id}`, '_blank')}
												className="p-2 hover:bg-accent rounded-md transition-colors"
												title="Open on YouTube"
												aria-label={`Open ${playlist.snippet?.title || 'Unknown Playlist'} on YouTube`}
											>
												<Icon name="link-2" className="w-4 h-4" />
											</button>

											{/* View Synced Playlist or Sync Button */}
											{playlist.isSynced && playlist.playlistInternalId ? (
												<>
													<Link
														to={`/music/services/youtube/playlist/${playlist.playlistInternalId}`}
														className="p-2 hover:bg-accent rounded-md transition-colors"
														title="View synced playlist"
														aria-label={`View details for ${playlist.snippet?.title || 'Unknown Playlist'}`}
													>
														<Icon name="eye-open" className="w-4 h-4" />
													</Link>
													<Form method="post" className="inline">
														<input type="hidden" name="intent" value={YOUTUBE_PLAYLIST_DISCOVERY_INTENTS.REMOVE_FROM_SYNC} />
														<input type="hidden" name="playlistId" value={playlist.playlistInternalId} />
														<button
															type="submit"
															className="p-2 hover:bg-destructive/10 text-foreground-destructive rounded-md transition-colors"
															title="Delete"
															aria-label={`Remove ${playlist.snippet?.title || 'Unknown Playlist'} from sync`}
														>
															<Icon name="trash" className="w-4 h-4" />
														</button>
													</Form>
												</>
											) : (
												<Form method="post" className="inline">
													<input type="hidden" name="intent" value={YOUTUBE_PLAYLIST_DISCOVERY_INTENTS.ADD_TO_SYNC} />
													<input type="hidden" name="playlistId" value={playlist.id} />
													<button
														type="submit"
														className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center gap-1.5 whitespace-nowrap"
														aria-label={`Add ${playlist.snippet?.title || 'Unknown Playlist'} to sync`}
													>
														<span className="text-lg leading-none">+</span>
														<span>Add to Sync</span>
													</button>
												</Form>
											)}
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* No Playlists State */}
			{hasConnection && playlists.length === 0 && (
				<Card>
					<CardContent className="text-center py-12">
						<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-xl font-semibold mb-2">No YouTube Playlists Found</h3>
						<p className="text-muted-foreground mb-6">
							You don't have any YouTube playlists. Create some playlists on YouTube to get started.
						</p>
						<Button 
							size="lg"
							onClick={() => window.open('https://youtube.com/playlist?list=LL', '_blank')}
							aria-label="Go to YouTube to create playlists"
						>
							<Icon name="link-2" className="h-5 w-5 mr-2" />
							Go to YouTube
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
