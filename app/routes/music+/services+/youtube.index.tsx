import { formatDistanceToNow } from 'date-fns'
import { data, Link, Form, useActionData, useLoaderData, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { requireUserId } from '#app/utils/auth.server'
import { createYouTubePlaylistService } from '#app/utils/youtube-playlist.server'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const youtubePlaylistService = createYouTubePlaylistService()
	
	const [playlists, syncStatus, hasConnection] = await Promise.all([
		youtubePlaylistService.getUserPlaylists(userId),
		youtubePlaylistService.getSyncStatus(userId),
		youtubePlaylistService.getStoredTokens(userId).then(tokens => !!tokens),
	])

	return data({
		playlists,
		syncStatus,
		hasConnection,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	
	const intent = formData.get('intent')
	
	if (typeof intent !== 'string') {
		return data({ status: 'error', message: 'Invalid form data' }, { status: 400 })
	}

	const youtubePlaylistService = createYouTubePlaylistService()

	try {
		switch (intent) {
			case 'sync': {
				// Check if user already has YouTube tokens
				const playlistService = createYouTubePlaylistService()
				const storedTokens = await playlistService.getStoredTokens(userId)
				
				if (storedTokens) {
					// User has tokens, sync directly
					try {
						const result = await playlistService.syncUserPlaylists(userId)
						return data({ status: 'success', ...result })
					} catch {
						// If sync fails, redirect to re-authenticate
						return data({ status: 'error', message: 'Authentication expired. Please reconnect your YouTube account.' }, { status: 401 })
					}
				} else {
					// No tokens, redirect to YouTube OAuth
					return data({ status: 'error', message: 'Please connect your YouTube account first.' }, { status: 401 })
				}
			}
			
			case 'remove': {
				const playlistId = formData.get('playlistId')
				if (typeof playlistId !== 'string') {
					return data({ status: 'error', message: 'Playlist ID is required' }, { status: 400 })
				}
				
				const result = await youtubePlaylistService.removePlaylist(playlistId, userId)
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
	const { playlists, syncStatus, hasConnection } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services">
							<Icon name="arrow-left" className="mr-2" />
							Back to Services
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
						{!hasConnection && (
							<Button asChild>
								<Link to="/music/services/youtube/auth">
									<Icon name="link-2" className="h-4 w-4 mr-2" />
									Connect YouTube
								</Link>
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Sync Status */}
			{hasConnection && (
				<Card className="mb-6">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Icon name="update" className="h-5 w-5" />
							Sync Status
						</CardTitle>
						<CardDescription>
							Your YouTube playlists sync information
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div>
								<p className="text-sm text-muted-foreground">Total Playlists</p>
								<p className="text-2xl font-bold">{syncStatus.totalPlaylists}</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Last Sync</p>
								<p className="text-lg">
									{syncStatus.lastSync 
										? formatDistanceToNow(syncStatus.lastSync, { addSuffix: true })
										: 'Never'
									}
								</p>
							</div>
							<div className="flex items-end">
								<Form method="post">
									<input type="hidden" name="intent" value="sync" />
									<Button type="submit">
										<Icon name="update" className="h-4 w-4 mr-2" />
										Sync Playlists
									</Button>
								</Form>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

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

			{/* Quick Actions */}
			<div className="mb-6">
				<h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
				<div className="flex flex-wrap gap-4">
					<Button asChild>
						<Link to="/music/services/import/youtube">
							<Icon name="download" className="h-4 w-4 mr-2" />
							Import YouTube Tracks
						</Link>
					</Button>
					{hasConnection && (
						<Button asChild variant="outline">
							<Link to="/music/services/youtube/playlists">
								<Icon name="file-text" className="h-4 w-4 mr-2" />
								Manage Playlists
							</Link>
						</Button>
					)}
					{hasConnection && (
						<Button asChild variant="outline">
							<Link to="/music/services/youtube/auth">
								<Icon name="lock-closed" className="h-4 w-4 mr-2" />
								Account Settings
							</Link>
						</Button>
					)}
				</div>
			</div>

			{/* Playlists Preview */}
			{hasConnection && playlists.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Icon name="file-text" className="h-5 w-5" />
							Your YouTube Playlists
						</CardTitle>
						<CardDescription>
							Your synced YouTube playlists (showing first 5)
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							{playlists.slice(0, 5).map((playlist: any) => (
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
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.youtubeId}`, '_blank')}
										>
											<Icon name="link-2" className="h-4 w-4" />
										</Button>
									</div>
								</div>
							))}
							{playlists.length > 5 && (
								<div className="pt-4 border-t">
									<Button asChild variant="outline" className="w-full">
										<Link to="/music/services/youtube/playlists">
											View All {playlists.length} Playlists
										</Link>
									</Button>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* No Playlists State */}
			{hasConnection && playlists.length === 0 && (
				<Card>
					<CardContent className="text-center py-8">
						<Icon name="file-text" className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-lg font-semibold mb-2">No YouTube Playlists</h3>
						<p className="text-muted-foreground mb-4">
							You don't have any YouTube playlists synced yet.
						</p>
						<Form method="post">
							<input type="hidden" name="intent" value="sync" />
							<Button type="submit">
								<Icon name="update" className="h-4 w-4 mr-2" />
								Sync Your Playlists
							</Button>
						</Form>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
