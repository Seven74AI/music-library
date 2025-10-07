import { type ServicePlaylist } from '@prisma/client'
import { formatDistanceToNow } from 'date-fns'
import { data, Form, useActionData, useLoaderData, Link, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { 
  YOUTUBE_SYNCED_PLAYLISTS_INTENTS,
  YOUTUBE_PAGE_TYPES,
  validateSyncedPlaylistsIntent,
  getIntentErrorMessage
} from '#app/types/youtube-intents'
import { requireUserId } from '#app/utils/auth.server'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'

/**
 * Loader function for YouTube synced playlists page
 * Fetches user's synced YouTube playlists
 * 
 * @param request - The incoming request
 * @returns Promise resolving to synced playlists data
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const servicePlaylistService = createServicePlaylistService()
	
	try {
		const playlists = await servicePlaylistService.getSyncedPlaylists('youtube', userId)
		
		return data({
			playlists,
		})
	} catch (error) {
		console.error('Error loading synced playlists:', error)
		// Return empty state instead of throwing to prevent page crash
		return data({
			playlists: [],
		})
	}
}

/**
 * Action function for YouTube synced playlists page
 * Handles playlist resync and removal operations
 * 
 * @param request - The incoming request with form data
 * @returns Promise resolving to action result
 */
export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	
	const intent = formData.get('intent')
	
	if (!validateSyncedPlaylistsIntent(intent)) {
		return data({ status: 'error', message: getIntentErrorMessage(YOUTUBE_PAGE_TYPES.SYNCED) }, { status: 400 })
	}

	const servicePlaylistService = createServicePlaylistService()

	try {
		switch (intent) {
			case YOUTUBE_SYNCED_PLAYLISTS_INTENTS.RESYNC: {
				const playlistId = formData.get('playlistId')
				if (typeof playlistId !== 'string' || playlistId.length === 0) {
					return data({ status: 'error', message: 'Valid playlist ID is required' }, { status: 400 })
				}
				
				const result = await servicePlaylistService.resyncPlaylist(playlistId, userId)
				return data({ status: 'success', ...result })
			}
			
			case YOUTUBE_SYNCED_PLAYLISTS_INTENTS.REMOVE: {
				const playlistId = formData.get('playlistId')
				if (typeof playlistId !== 'string' || playlistId.length === 0) {
					return data({ status: 'error', message: 'Valid playlist ID is required' }, { status: 400 })
				}
				
				const result = await servicePlaylistService.removePlaylistFromSync(playlistId, userId)
				return data({ status: 'success', ...result })
			}
			
			default:
				return data({ status: 'error', message: 'Invalid action' })
		}
	} catch (error) {
		console.error('Error in synced playlists action:', error)
		return data({
			status: 'error',
			message: error instanceof Error ? error.message : 'An error occurred',
		})
	}
}

export default function YouTubeSyncedPlaylistsPage() {
	const { playlists } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services/youtube">
							<Icon name="arrow-left" className="mr-2" />
							Back to YouTube Service
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
						<h1 className="text-3xl font-bold">Synced YouTube Playlists</h1>
						<p className="text-muted-foreground mt-1">
							Manage your synchronized YouTube playlists
						</p>
					</div>
				</div>
			</div>

			{/* Navigation */}
			<div className="mb-6">
				<Button asChild variant="outline">
					<Link to="/music/services/youtube/playlists">
						<Icon name="plus" className="h-4 w-4 mr-2" />
						Discover More Playlists
					</Link>
				</Button>
			</div>

			{/* Action Messages */}
			{actionData?.status === 'error' && (
				<div className="mb-6 rounded-md bg-destructive/15 p-4">
					<div className="flex items-center gap-2">
						<Icon name="question-mark-circled" className="h-4 w-4 text-destructive" />
						<p className="text-sm text-destructive font-medium">Error</p>
					</div>
					<p className="text-sm text-destructive mt-1">{actionData.message}</p>
				</div>
			)}

			{actionData?.status === 'success' && (
				<div className="mb-6 rounded-md bg-green-50 p-4">
					<div className="flex items-center gap-2">
						<Icon name="check-circled" className="h-4 w-4 text-green-600" />
						<p className="text-sm text-green-800 font-medium">Success</p>
					</div>
					<p className="text-sm text-green-700 mt-1">{actionData.message}</p>
				</div>
			)}

			{/* Synced Playlists List */}
			{playlists.length > 0 && (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{playlists.map((playlist: ServicePlaylist) => (
						<Card key={playlist.id} className="hover:shadow-md transition-shadow">
							<CardHeader className="pb-3">
								<div className="flex items-start gap-3">
									{playlist.thumbnailUrl ? (
										<img 
											src={playlist.thumbnailUrl} 
											alt={playlist.title}
											className="w-16 h-16 rounded object-cover flex-shrink-0"
										/>
									) : (
										<div className="w-16 h-16 bg-muted rounded flex items-center justify-center flex-shrink-0">
											<Icon name="file-text" className="h-8 w-8 text-muted-foreground" />
										</div>
									)}
									<div className="flex-1 min-w-0">
										<CardTitle className="text-lg line-clamp-2 mb-1">
											{playlist.title}
										</CardTitle>
										<CardDescription className="line-clamp-2">
											{playlist.description || 'No description'}
										</CardDescription>
									</div>
								</div>
							</CardHeader>
							<CardContent className="pt-0">
								<div className="space-y-3">
									<div className="flex items-center justify-between text-sm text-muted-foreground">
										<span>{playlist.itemCount} tracks</span>
										<span>{playlist.channelTitle}</span>
									</div>
									
									{playlist.lastSyncedAt && (
										<div className="text-sm text-muted-foreground">
											Last synced: {formatDistanceToNow(playlist.lastSyncedAt, { addSuffix: true })}
										</div>
									)}
									
									<div className="h-[1px] w-full bg-border" />
									
									<div className="flex items-center justify-between">
										<span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-transparent bg-green-100 text-green-800">
											Synced
										</span>
										
										<div className="flex gap-2">
											<Button
												variant="outline"
												size="sm"
												asChild
											>
												<Link to={`/music/services/youtube/playlist/${playlist.id}`} aria-label={`View details for ${playlist.title || 'Unknown Playlist'}`}>
													<Icon name="eye-open" className="h-4 w-4" />
												</Link>
											</Button>
											
											<Button
												variant="outline"
												size="sm"
												onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.externalId}`, '_blank')}
												aria-label={`Open ${playlist.title || 'Unknown Playlist'} on YouTube`}
											>
												<Icon name="link-2" className="h-4 w-4" />
											</Button>
											
											<Form method="post" className="inline">
												<input type="hidden" name="intent" value={YOUTUBE_SYNCED_PLAYLISTS_INTENTS.RESYNC} />
												<input type="hidden" name="playlistId" value={playlist.id} />
												<Button
													type="submit"
													variant="outline"
													size="sm"
													aria-label={`Resync ${playlist.title || 'Unknown Playlist'}`}
												>
													<Icon name="update" className="h-4 w-4" />
												</Button>
											</Form>
											
											<Form method="post" className="inline">
												<input type="hidden" name="intent" value={YOUTUBE_SYNCED_PLAYLISTS_INTENTS.REMOVE} />
												<input type="hidden" name="playlistId" value={playlist.id} />
												<Button
													type="submit"
													variant="outline"
													size="sm"
													className="text-destructive hover:text-destructive"
													aria-label={`Remove ${playlist.title || 'Unknown Playlist'} from sync`}
													onClick={(e) => {
														if (!confirm('Are you sure you want to remove this playlist from sync? This will not delete the playlist from YouTube.')) {
															e.preventDefault()
														}
													}}
												>
													<Icon name="trash" className="h-4 w-4" />
												</Button>
											</Form>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* No Synced Playlists State */}
			{playlists.length === 0 && (
				<Card>
					<CardContent className="text-center py-12">
						<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-xl font-semibold mb-2">No Synced Playlists</h3>
						<p className="text-muted-foreground mb-6">
							You haven't synced any YouTube playlists yet. Discover and sync your playlists to get started.
						</p>
						<Button asChild size="lg">
							<Link to="/music/services/youtube/playlists">
								<Icon name="plus" className="h-5 w-5 mr-2" />
								Discover YouTube Playlists
							</Link>
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
