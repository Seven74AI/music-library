import { formatDistanceToNow } from 'date-fns'
import { data, Form, useActionData, useLoaderData, Link, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { 
  isPlaylistWithTracks,
  isTrackWithUserStatus,
  isErrorActionResult,
  isSuccessActionResult
} from '#app/types/frontend'
import { 
  YOUTUBE_PLAYLIST_DETAIL_INTENTS,
  YOUTUBE_PAGE_TYPES,
  validatePlaylistDetailIntent,
  getIntentErrorMessage
} from '#app/types/youtube-intents'
import { requireUserId } from '#app/utils/auth.server'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'
import { redirectWithToast } from '#app/utils/toast.server.ts'

/**
 * Loader function for YouTube playlist detail page
 * Fetches playlist details and tracks with user library status
 * 
 * @param request - The incoming request
 * @param params - Route parameters containing playlist ID
 * @returns Promise resolving to playlist and tracks data
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const playlistId = params.id
	
	if (!playlistId) {
		throw new Response('Playlist ID is required', { status: 400 })
	}

	const servicePlaylistService = createServicePlaylistService()
	
	try {
		const result = await servicePlaylistService.getPlaylistTracksWithUserStatus(playlistId, userId)
		
		return data({
			playlist: result.playlist,
			tracks: result.tracks,
		})
	} catch (error) {
		console.error('Error loading playlist:', error)
		// Provide more specific error messages
		if (error instanceof Error && error.message.includes('not found')) {
			throw new Response('Playlist not found', { status: 404 })
		}
		throw new Response('Failed to load playlist', { status: 500 })
	}
}

/**
 * Action function for YouTube playlist detail page
 * Handles track library management and playlist operations
 * 
 * @param request - The incoming request with form data
 * @param params - Route parameters containing playlist ID
 * @returns Promise resolving to action result
 */
export async function action({ request, params }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	
	const intent = formData.get('intent')
	
	if (!validatePlaylistDetailIntent(intent)) {
		return data({ status: 'error', message: getIntentErrorMessage(YOUTUBE_PAGE_TYPES.DETAIL) }, { status: 400 })
	}

	const servicePlaylistService = createServicePlaylistService()

	try {
		switch (intent) {
			case 'add-to-library': {
				const trackId = formData.get('trackId')
				if (typeof trackId !== 'string' || trackId.length === 0) {
					return data({ status: 'error', message: 'Valid track ID is required' }, { status: 400 })
				}
				
				await servicePlaylistService.addTrackToUserLibrary(userId, trackId)
				return data({ status: 'success', message: 'Track added to your library' })
			}
			
			case 'remove-from-library': {
				const trackId = formData.get('trackId')
				if (typeof trackId !== 'string' || trackId.length === 0) {
					return data({ status: 'error', message: 'Valid track ID is required' }, { status: 400 })
				}
				
				await servicePlaylistService.removeTrackFromUserLibrary(userId, trackId)
				return data({ status: 'success', message: 'Track removed from your library' })
			}
			
			case YOUTUBE_PLAYLIST_DETAIL_INTENTS.REFRESH: {
				const result = await servicePlaylistService.resyncPlaylist(params.id!, userId)
				return data({ status: 'success', ...result })
			}
			
			case 'remove': {
				const result = await servicePlaylistService.removePlaylistFromSync(YOUTUBE_SERVICE.NAME, params.id!, userId)
				if (result.success) {
					return redirectWithToast(
						'/music/services/youtube/playlists',
						{
							title: 'Playlist Removed',
							description: 'Playlist removed from sync successfully',
							type: 'success',
						}
					)
				}

				return data({ status: 'error', ...result })
			}
			
			default:
				return data({ status: 'error', message: 'Invalid action' })
		}
	} catch (error) {
		console.error('Error in playlist action:', error)
		return data({
			status: 'error',
			message: error instanceof Error ? error.message : 'An error occurred',
		})
	}
}

export default function YouTubeSyncedPlaylistDetailPage() {
	const loaderData = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	// Validate loader data with type guards
	if (!isPlaylistWithTracks(loaderData.playlist)) {
		throw new Error('Invalid playlist data received from server')
	}

	if (!Array.isArray(loaderData.tracks) || !loaderData.tracks.every(isTrackWithUserStatus)) {
		throw new Error('Invalid tracks data received from server')
	}

	const { playlist, tracks } = loaderData

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services/youtube/synced-playlists">
							<Icon name="arrow-left" className="mr-2" />
							Back to Synced Playlists
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
						<h1 className="text-3xl font-bold">{playlist.title}</h1>
						<p className="text-muted-foreground mt-1">
							YouTube Playlist • {playlist.channelTitle}
						</p>
					</div>
				</div>
			</div>

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
				<div className="mb-6 rounded-md bg-green-50 p-4">
					<div className="flex items-center gap-2">
						<Icon name="check-circled" className="h-4 w-4 text-green-600" />
						<p className="text-sm text-green-800 font-medium">Success</p>
					</div>
					<p className="text-sm text-green-700 mt-1">{isSuccessActionResult(actionData) ? actionData.message : 'Operation completed successfully'}</p>
				</div>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Playlist Info */}
				<div className="lg:col-span-1">
					<Card>
						<CardHeader>
							<div className="flex items-start gap-4">
								{playlist.thumbnailUrl ? (
									<img 
										src={playlist.thumbnailUrl} 
										alt={playlist.title}
										className="w-24 h-24 rounded object-cover flex-shrink-0"
									/>
								) : (
									<div className="w-24 h-24 bg-muted rounded flex items-center justify-center flex-shrink-0">
										<Icon name="file-text" className="h-12 w-12 text-muted-foreground" />
									</div>
								)}
								<div className="flex-1 min-w-0">
									<CardTitle className="text-xl line-clamp-2 mb-2">
										{playlist.title}
									</CardTitle>
									<CardDescription className="line-clamp-3">
										{playlist.description || 'No description'}
									</CardDescription>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<p className="text-muted-foreground">Tracks</p>
									<p className="font-semibold">{tracks.length}</p>
								</div>
								<div>
									<p className="text-muted-foreground">Channel</p>
									<p className="font-semibold">{playlist.channelTitle}</p>
								</div>
							</div>
							
							{playlist.lastSyncedAt && (
								<div>
									<p className="text-muted-foreground text-sm">Last Synced</p>
									<p className="text-sm">
										{formatDistanceToNow(playlist.lastSyncedAt, { addSuffix: true })}
									</p>
								</div>
							)}

							<div className="h-[1px] w-full bg-border" />
							
							<div className="space-y-3">
								<Button
									variant="outline"
									className="w-full"
									onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.externalId}`, '_blank')}
									aria-label={`Open ${playlist.title || 'Unknown Playlist'} on YouTube`}
								>
									<Icon name="link-2" className="h-4 w-4 mr-2" />
									View on YouTube
								</Button>
								
								<Form method="post" className="w-full">
									<input type="hidden" name="intent" value={YOUTUBE_PLAYLIST_DETAIL_INTENTS.REFRESH} />
									<Button type="submit" variant="outline" className="w-full" aria-label={`Re-sync ${playlist.title || 'Unknown Playlist'}`}>
										<Icon name="update" className="h-4 w-4 mr-2" />
										Re-sync Playlist
									</Button>
								</Form>
								
								<Form method="post" className="w-full">
									<input type="hidden" name="intent" value="remove" />
									<Button
										type="submit"
										variant="destructive"
										className="w-full"
										aria-label={`Remove ${playlist.title || 'Unknown Playlist'} from sync`}
										onClick={(e) => {
											if (!confirm('Are you sure you want to remove this playlist from sync? This will not delete the playlist from YouTube.')) {
												e.preventDefault()
											}
										}}
									>
										<Icon name="trash" className="h-4 w-4 mr-2" />
										Remove from Sync
									</Button>
								</Form>
							</div>
						</CardContent>
					</Card>
				</div>

				{/* Playlist Tracks */}
				<div className="lg:col-span-2">
					<Card>
						<CardHeader>
							<CardTitle>Playlist Tracks</CardTitle>
							<CardDescription>
								{tracks.length} tracks in this playlist
							</CardDescription>
						</CardHeader>
						<CardContent>
							{tracks.length === 0 ? (
								<div className="text-center py-12">
									<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
									<h3 className="text-lg font-semibold mb-2">No Tracks Found</h3>
									<p className="text-muted-foreground mb-4">
										This playlist doesn't have any tracks yet.
									</p>
									<Button
										variant="outline"
										onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.externalId}`, '_blank')}
										aria-label={`View ${playlist.title || 'Unknown Playlist'} on YouTube`}
									>
										<Icon name="link-2" className="h-4 w-4 mr-2" />
										View on YouTube
									</Button>
								</div>
							) : (
								<div className="space-y-3">
									{tracks.map((track) => (
										<div 
											key={track.id}
											className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
										>
											<div className="text-sm text-muted-foreground w-8">
												{track.position}
											</div>
											{track.thumbnailUrl ? (
												<img 
													src={track.thumbnailUrl} 
													alt={track.title}
													className="w-16 h-12 rounded object-cover flex-shrink-0"
												/>
											) : (
												<div className="w-16 h-12 bg-muted rounded flex items-center justify-center flex-shrink-0">
													<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
												</div>
											)}
											<div className="flex-1 min-w-0">
												<h3 className="font-medium line-clamp-2 mb-1">
													{track.title}
												</h3>
												<p className="text-sm text-muted-foreground line-clamp-1">
													{track.artist}
												</p>
												
												{!track.isInUserLibrary && (
													<span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-gray-200 bg-gray-50 text-gray-600 mt-2">
														Not in Library
													</span>
												)}
											</div>
											<div className="flex items-center gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => track.serviceUrl && window.open(track.serviceUrl, '_blank')}
													aria-label={`Open ${track.title} on YouTube`}
												>
													<Icon name="link-2" className="h-4 w-4" />
												</Button>
												
												{track.isInUserLibrary ? (
													<Form method="post" className="inline">
														<input type="hidden" name="intent" value="remove-from-library" />
														<input type="hidden" name="trackId" value={track.id} />
														<Button
															type="submit"
															variant="destructive"
															size="sm"
															aria-label={`Remove ${track.title} from library`}
														>
															<Icon name="trash" className="h-4 w-4 mr-2" />
															Remove from Library
														</Button>
													</Form>
												) : (
													<Form method="post" className="inline">
														<input type="hidden" name="intent" value="add-to-library" />
														<input type="hidden" name="trackId" value={track.id} />
														<Button
															type="submit"
															size="sm"
															aria-label={`Add ${track.title} to library`}
														>
															<Icon name="plus" className="h-4 w-4 mr-2" />
															Add to Library
														</Button>
													</Form>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}
