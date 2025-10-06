import { formatDistanceToNow } from 'date-fns'
import { data, redirect, Form, useActionData, useLoaderData, Link, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
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
						return redirect('/music/services/youtube/auth')
					}
				} else {
					// No tokens, redirect to YouTube OAuth
					return redirect('/music/services/youtube/auth')
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

export default function YouTubePlaylistsPage() {
	const { playlists, syncStatus, hasConnection } = useLoaderData<typeof loader>()
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
						<h1 className="text-3xl font-bold">YouTube Playlists</h1>
						<p className="text-muted-foreground mt-1">
							Manage your synced YouTube playlists
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
							Connect your YouTube account to sync and manage your playlists.
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

			{/* Playlists List */}
			{hasConnection && playlists.length > 0 && (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{playlists.map((playlist: any) => (
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
									
									<div className="h-[1px] w-full bg-border" />
									
									<div className="flex items-center justify-between">
										<span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
											playlist.isActive 
												? 'border-transparent bg-secondary text-secondary-foreground' 
												: 'border-transparent bg-muted text-muted-foreground'
										}`}>
											{playlist.isActive ? 'Active' : 'Inactive'}
										</span>
										
										<div className="flex gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.youtubeId}`, '_blank')}
											>
												<Icon name="link-2" className="h-4 w-4" />
											</Button>
											
											<Form method="post" className="inline">
												<input type="hidden" name="intent" value="remove" />
												<input type="hidden" name="playlistId" value={playlist.id} />
												<Button
													type="submit"
													variant="outline"
													size="sm"
													className="text-destructive hover:text-destructive"
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

			{/* No Playlists State */}
			{hasConnection && playlists.length === 0 && (
				<Card>
					<CardContent className="text-center py-12">
						<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-xl font-semibold mb-2">No YouTube Playlists</h3>
						<p className="text-muted-foreground mb-6">
							You don't have any YouTube playlists synced yet. Sync your playlists to get started.
						</p>
						<Form method="post">
							<input type="hidden" name="intent" value="sync" />
							<Button type="submit" size="lg">
								<Icon name="update" className="h-5 w-5 mr-2" />
								Sync Your YouTube Playlists
							</Button>
						</Form>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
