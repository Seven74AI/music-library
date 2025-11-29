import { formatDistanceToNow } from 'date-fns'
import { data, Link, useActionData, useLoaderData, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { ServiceDisconnectButton } from '#app/components/service-disconnect-button'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { isErrorActionResult, isSuccessActionResult } from '#app/types/frontend'
import { requireUserId } from '#app/utils/auth.server'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'
import { hasValidYouTubeOAuth } from '#app/utils/youtube-oauth-validation.server'
import { type ServicePlaylist } from '#prisma/client.js'

/**
 * Loader function for YouTube service overview page
 * Fetches synced playlists and connection status
 * 
 * @param request - The incoming request
 * @returns Promise resolving to synced playlists and connection status
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const servicePlaylistService = createServicePlaylistService()

	const [syncedPlaylists, hasConnection] = await Promise.all([
		servicePlaylistService.getSyncedPlaylists(YOUTUBE_SERVICE.NAME, userId),
		hasValidYouTubeOAuth(userId),
	])

	return data({
		syncedPlaylists,
		hasConnection,
	})
}

/**
 * Action function for YouTube service overview page
 * Handles sync and remove playlist operations
 * 
 * @param request - The incoming request with form data
 * @returns Promise resolving to action result
 */
export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()

	const intent = formData.get('intent')

	if (typeof intent !== 'string') {
		return data({ status: 'error', message: 'Invalid form data' }, { status: 400 })
	}

	const servicePlaylistService = createServicePlaylistService()

	try {
		switch (intent) {
			case 'sync': {
				// Check if user already has valid YouTube OAuth
				const hasValidOAuth = await hasValidYouTubeOAuth(userId)

				if (hasValidOAuth) {
					// User has valid OAuth, redirect to playlists page to sync
					return data({ status: 'success', message: 'Redirecting to playlist management...' })
				} else {
					// No valid OAuth, redirect to YouTube OAuth
					return data({ status: 'error', message: 'Please connect your YouTube account first.' }, { status: 401 })
				}
			}

			case 'remove': {
				const playlistId = formData.get('playlistId')
				if (typeof playlistId !== 'string') {
					return data({ status: 'error', message: 'Playlist ID is required' }, { status: 400 })
				}

				const result = await servicePlaylistService.removePlaylistFromSync(YOUTUBE_SERVICE.NAME, playlistId, userId)
				return data({ status: 'success', ...result })
			}

			default:
				return data({ status: 'error', message: 'Invalid action' })
		}
	} catch (error) {
		return data({
			status: 'error',
			message: error instanceof Error ? error.message : 'An error occurred',
		})
	}
}

export default function YouTubeServicePage() {
	const { syncedPlaylists, hasConnection } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<div className="py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services">
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
						<h1 className="text-3xl font-bold">YouTube Service</h1>
						<p className="text-muted-foreground mt-1">
							Manage your YouTube playlists and sync settings
						</p>
					</div>
				</div>
			</div>

			{/* Quick Actions */}
			<div className="mb-6">
				<h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
				<div className="flex flex-wrap gap-4">
					{hasConnection && (
						<Button asChild variant="outline">
							<Link to="/music/services/youtube/playlists">
								<Icon name="file-text" className="h-4 w-4 mr-2" />
								Discover & Sync Playlists
							</Link>
						</Button>
					)}
					{hasConnection && (
						<Button asChild variant="outline">
							<Link to="/music/services/youtube/synced-playlists">
								<Icon name="file-text" className="h-4 w-4 mr-2" />
								Manage Synced Playlists
							</Link>
						</Button>
					)}
				</div>
			</div>

			{/* Connection Status */}
			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Icon name="link-2" className="h-5 w-5" />
						Connection Status
					</CardTitle>
					<CardDescription>
						Your YouTube account connection and sync status
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className={`w-3 h-3 rounded-full ${hasConnection ? 'bg-green-500' : 'bg-red-500'}`} />
							<span className="font-medium">
								{hasConnection ? 'Connected to YouTube' : 'Not connected to YouTube'}
							</span>
						</div>
						<div className="flex items-center gap-2">
							{!hasConnection ? (
								<Button asChild>
									<Link to="/music/services/youtube/auth">
										<Icon name="link-2" className="h-4 w-4 mr-2" />
										Connect YouTube
									</Link>
								</Button>
							) : (
								<ServiceDisconnectButton 
									serviceName="YouTube"
									disconnectUrl="/music/services/youtube/disconnect"
								/>
							)}
						</div>
					</div>
				</CardContent>
			</Card>

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


			{/* Synced Playlists Preview */}
			{hasConnection && syncedPlaylists.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Icon name="file-text" className="h-5 w-5" />
							Your Synced YouTube Playlists
						</CardTitle>
						<CardDescription>
							Your synchronized YouTube playlists (showing first 5)
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							{syncedPlaylists.slice(0, 5).map((playlist: ServicePlaylist) => (
								<div key={playlist.id} className="flex items-center justify-between p-4 border rounded-lg">
									<div className="flex items-center gap-4">
										{playlist.thumbnailUrl ? (
											<img
												src={playlist.thumbnailUrl}
												alt={playlist.title}
												className="w-12 h-12 rounded object-cover"
											/>
										) : (
											<div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
												<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
											</div>
										)}
										<div>
											<h3 className="font-medium">{playlist.title}</h3>
											<p className="text-sm text-muted-foreground">
												{playlist.itemCount} tracks • {playlist.channelTitle}
											</p>
											<p className="text-xs text-muted-foreground">
												Last synced: {formatDistanceToNow(playlist.updatedAt, { addSuffix: true })}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button asChild variant="outline" size="sm">
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
									</div>
								</div>
							))}
							{syncedPlaylists.length > 5 && (
								<div className="pt-4 border-t">
									<Button asChild variant="outline" className="w-full">
										<Link to="/music/services/youtube/synced-playlists">
											View All {syncedPlaylists.length} Synced Playlists
										</Link>
									</Button>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* No Synced Playlists State */}
			{hasConnection && syncedPlaylists.length === 0 && (
				<Card>
					<CardContent className="text-center py-8">
						<Icon name="file-text" className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-lg font-semibold mb-2">No Synced YouTube Playlists</h3>
						<p className="text-muted-foreground mb-4">
							You haven't synchronized any YouTube playlists yet.
						</p>
						<Button asChild>
							<Link to="/music/services/youtube/playlists">
								<Icon name="file-text" className="h-4 w-4 mr-2" />
								Discover & Sync Playlists
							</Link>
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
