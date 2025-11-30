import { formatDistanceToNow } from 'date-fns'
import { useState, useEffect, useRef } from 'react'
import { data, Form, useActionData, useLoaderData, Link, useNavigate, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { type BreadcrumbHandle } from '#app/components/breadcrumbs'
import { DeletedVideoMatchDialog } from '#app/components/deleted-video-match-dialog'
import { TrackListItem } from '#app/components/track-list-item'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '#app/components/ui/alert-dialog'
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
import { getPlaylistTitle } from '#app/utils/breadcrumb-utils'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'
import { redirectWithToast } from '#app/utils/toast.server'

export const handle: BreadcrumbHandle = {
	breadcrumb: ({ data }) => getPlaylistTitle(data),
}

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
			case YOUTUBE_PLAYLIST_DETAIL_INTENTS.REFRESH: {
				const result = await servicePlaylistService.resyncPlaylist(params.id!, userId)
				if (result.success) {
					return data({ status: 'success', ...result })
				}
				return data({ 
					status: 'error', 
					message: result.message || 'Failed to sync playlist. Please try again.' 
				})
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
			
			case YOUTUBE_PLAYLIST_DETAIL_INTENTS.CONFIRM_DELETED_MATCH: {
				const matchesJson = formData.get('matches')
				if (typeof matchesJson !== 'string') {
					return data({ status: 'error', message: 'Invalid matches data' }, { status: 400 })
				}

				try {
					const matches = JSON.parse(matchesJson) as Array<{
						deletedItemId: string | undefined
						selectedTrackId: string | null
						position: number
						action: 'match' | 'new' | 'skip'
					}>

					const result = await servicePlaylistService.confirmDeletedVideoMatches(params.id!, matches, userId)
					
					if (result.success) {
						return data({ 
							status: 'success', 
							message: result.message 
						})
					}

					return data({ 
						status: 'error', 
						message: result.message || 'Failed to process matches. Please try again.' 
					})
				} catch (error) {
					console.error('Error parsing matches:', error)
					return data({ 
						status: 'error', 
						message: 'Invalid matches format' 
					}, { status: 400 })
				}
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
	const navigate = useNavigate()
	const [showDialog, setShowDialog] = useState(false)
	const [syncButtonDisabled, setSyncButtonDisabled] = useState(false)
	const hadPendingMatchesRef = useRef(false)

	// Check for pending matches in action data
	const pendingMatches = actionData && 'pendingMatches' in actionData && Array.isArray(actionData.pendingMatches) 
		? actionData.pendingMatches 
		: []

	// Show dialog when pending matches exist
	useEffect(() => {
		if (pendingMatches.length > 0) {
			setShowDialog(true)
			hadPendingMatchesRef.current = true
		}
	}, [pendingMatches.length])

	// Handle dialog close
	const handleDialogClose = () => {
		setShowDialog(false)
		hadPendingMatchesRef.current = false
	}

	// Handle sync button state change
	const handleSyncButtonStateChange = (disabled: boolean) => {
		setSyncButtonDisabled(disabled)
	}

	// Close dialog and reload page after successful confirmation
	useEffect(() => {
		if (actionData && 'status' in actionData && actionData.status === 'success') {
			// Check if we had pending matches before and they're now gone (confirmation was successful)
			if (hadPendingMatchesRef.current && pendingMatches.length === 0 && showDialog) {
				// Matches were confirmed, close dialog and reload page
				setShowDialog(false)
				hadPendingMatchesRef.current = false
				void navigate('.', { replace: true })
			}
		}
	}, [actionData, navigate, pendingMatches.length, showDialog])

	return (
		<div className="py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services/youtube/synced-playlists">
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
						<h1 className="text-3xl font-bold">{playlist.title}</h1>
						<p className="text-muted-foreground mt-1">
							YouTube Playlist • {playlist.channelTitle}
						</p>
					</div>
				</div>
			</div>

			{/* Pending Matches Dialog */}
			{showDialog && pendingMatches.length > 0 && (
				<DeletedVideoMatchDialog
					pendingMatches={pendingMatches}
					playlistId={playlist.id}
					onClose={handleDialogClose}
					onSyncButtonStateChange={handleSyncButtonStateChange}
				/>
			)}

			{/* Persistent Banner for Pending Matches */}
			{!showDialog && pendingMatches.length > 0 && (
				<div className="mb-6 rounded-md bg-yellow-50 p-4">
					<div className="flex items-center gap-2">
						<Icon name="question-mark-circled" className="h-4 w-4 text-yellow-600" />
						<p className="text-sm text-yellow-800 font-medium">Pending Matches</p>
					</div>
					<p className="text-sm text-yellow-700 mt-1">
						You have {pendingMatches.length} pending match(es) that need confirmation. Please complete the confirmation to sync again.
					</p>
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
				<div className="mb-6 rounded-md bg-green-50 p-4">
					<div className="flex items-center gap-2">
						<Icon name="check-circled" className="h-4 w-4 text-green-600" />
						<p className="text-sm text-green-800 font-medium">Success</p>
					</div>
					<p className="text-sm text-green-700 mt-1">{isSuccessActionResult(actionData) ? actionData.message : 'Operation completed successfully'}</p>
					{'deletedTracks' in actionData && Array.isArray(actionData.deletedTracks) && actionData.deletedTracks.length > 0 && (
						<div className="mt-2 text-sm text-green-700">
							<p className="font-medium">Deleted tracks: {actionData.deletedTracks.length}</p>
							<ul className="list-disc list-inside mt-1 space-y-1">
								{actionData.deletedTracks.slice(0, 5).map((track: { id: string; title: string }) => (
									<li key={track.id}>{track.title}</li>
								))}
								{actionData.deletedTracks.length > 5 && (
									<li className="text-muted-foreground">...and {actionData.deletedTracks.length - 5} more</li>
								)}
							</ul>
						</div>
					)}
					{'removedTracks' in actionData && Array.isArray(actionData.removedTracks) && actionData.removedTracks.length > 0 && (
						<div className="mt-2 text-sm text-green-700">
							<p className="font-medium">Removed tracks: {actionData.removedTracks.length}</p>
							<ul className="list-disc list-inside mt-1 space-y-1">
								{actionData.removedTracks.slice(0, 5).map((track: { id: string; title: string }) => (
									<li key={track.id}>{track.title}</li>
								))}
								{actionData.removedTracks.length > 5 && (
									<li className="text-muted-foreground">...and {actionData.removedTracks.length - 5} more</li>
								)}
							</ul>
						</div>
					)}
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
									<Button 
										type="submit" 
										variant="outline" 
										className="w-full" 
										disabled={syncButtonDisabled}
										aria-label={`Re-sync ${playlist.title || 'Unknown Playlist'}`}
									>
										<Icon name="update" className="h-4 w-4 mr-2" />
										Re-sync Playlist
									</Button>
									{syncButtonDisabled && (
										<p className="text-xs text-muted-foreground mt-1">
											Please complete pending matches first
										</p>
									)}
								</Form>
								
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											variant="destructive"
											className="w-full"
											aria-label={`Remove ${playlist.title || 'Unknown Playlist'} from sync`}
										>
											<Icon name="trash" className="h-4 w-4 mr-2" />
											Remove from Sync
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Remove Playlist from Sync</AlertDialogTitle>
											<AlertDialogDescription>
												Are you sure you want to remove this playlist from sync? This will not delete the playlist from YouTube.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<Form method="post" className="inline">
												<input type="hidden" name="intent" value="remove" />
												<AlertDialogAction asChild>
													<Button type="submit" variant="destructive">
														Remove from Sync
													</Button>
												</AlertDialogAction>
											</Form>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
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
						<CardContent className="max-h-[600px] overflow-y-auto">
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
								<div className="space-y-1">
									{/* Table Header */}
									<div className="flex items-center gap-4 px-4 py-2 text-sm font-medium text-muted-foreground border-b">
										<div className="w-8 flex items-center justify-center">#</div>
										<div className="flex-1 min-w-0">Title</div>
										<div className="w-8 flex items-center justify-center"></div>
									</div>
									{tracks.map((track, index) => {
										// Convert TrackWithUserStatus to TrackListItem format
										const trackForListItem = {
											id: track.id,
											title: track.title,
											artist: track.artist,
											duration: track.duration,
											coverImage: track.coverImage,
											serviceUrl: track.serviceUrl,
											service: track.service ? {
												displayName: track.service.displayName,
												logoUrl: track.service.logoUrl
											} : null
										}

										const userTrack = {
											createdAt: track.createdAt
										}


										return (
											<TrackListItem
												key={track.id}
												track={trackForListItem}
												userTrack={userTrack}
												index={index}
												playlistContext={{ type: 'playlist', playlistId: playlist.id }}
												isDeleted={track.isDeleted}
												showDuration={false} // Hide duration on YouTube playlist browsing
											/>
										)
									})}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}
