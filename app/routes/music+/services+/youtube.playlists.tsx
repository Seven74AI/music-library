import { data, Form, useActionData, useLoaderData, Link, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { type YouTubePlaylist } from '#app/types/youtube'
import { requireUserId } from '#app/utils/auth.server'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const servicePlaylistService = createServicePlaylistService()
	
	try {
		const result = await servicePlaylistService.getAllPlaylistsWithSyncStatus('youtube', userId)
		
		return data({
			playlists: result.playlists as YouTubePlaylist[],
			hasConnection: result.hasConnection,
			service: result.service,
		})
	} catch (error) {
		console.error('Error loading YouTube playlists:', error)
		// Return empty state instead of throwing to prevent page crash
		return data({
			playlists: [] as YouTubePlaylist[],
			hasConnection: false,
			service: null,
		})
	}
}

// Validation helpers
function validateIntent(intent: unknown): intent is string {
	return typeof intent === 'string' && ['add-to-sync', 'remove-from-sync'].includes(intent)
}

function validatePlaylistId(playlistId: unknown): playlistId is string {
	return typeof playlistId === 'string' && playlistId.length > 0
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	
	const intent = formData.get('intent')
	
	if (!validateIntent(intent)) {
		return data({ status: 'error', message: 'Invalid intent. Must be add-to-sync or remove-from-sync' }, { status: 400 })
	}

	const servicePlaylistService = createServicePlaylistService()

	try {
		switch (intent) {
			case 'add-to-sync': {
				const playlistId = formData.get('playlistId')
				if (!validatePlaylistId(playlistId)) {
					return data({ status: 'error', message: 'Valid playlist ID is required' }, { status: 400 })
				}
				
				const result = await servicePlaylistService.addPlaylistToSync('youtube', playlistId, userId)
				return data({ status: 'success', ...result })
			}
			
			case 'remove-from-sync': {
				const playlistId = formData.get('playlistId')
				if (!validatePlaylistId(playlistId)) {
					return data({ status: 'error', message: 'Valid playlist ID is required' }, { status: 400 })
				}
				
				const result = await servicePlaylistService.removePlaylistFromSync(playlistId, userId)
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

export default function YouTubePlaylistsPage() {
	const { playlists, hasConnection } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	
	// Type-safe access to playlists
	const typedPlaylists = playlists as YouTubePlaylist[]

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

			{/* Playlists Table */}
			{hasConnection && typedPlaylists.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Your YouTube Playlists</CardTitle>
						<CardDescription>
							Choose which playlists to sync to your music library
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="overflow-x-auto">
							<table className="w-full">
								<thead>
									<tr className="border-b">
										<th className="text-left p-4">Playlist</th>
										<th className="text-left p-4">Channel</th>
										<th className="text-left p-4">Tracks</th>
										<th className="text-left p-4">Status</th>
										<th className="text-left p-4">Actions</th>
									</tr>
								</thead>
								<tbody>
									{typedPlaylists.map((playlist) => (
										<tr key={playlist.id} className="border-b hover:bg-muted/50">
											<td className="p-4">
												<div className="flex items-center gap-3">
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
													<div className="min-w-0">
														<h3 className="font-medium line-clamp-1">
															{playlist.snippet?.title || 'Unknown Title'}
														</h3>
														<p className="text-sm text-muted-foreground line-clamp-1">
															{playlist.snippet?.description || 'No description'}
														</p>
													</div>
												</div>
											</td>
											<td className="p-4">
												<span className="text-sm">
													{playlist.snippet?.channelTitle || 'Unknown Channel'}
												</span>
											</td>
											<td className="p-4">
												<span className="text-sm">
													{playlist.contentDetails?.itemCount || 0} tracks
												</span>
											</td>
											<td className="p-4">
												<span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
													playlist.isSynced 
														? 'border-transparent bg-green-100 text-green-800' 
														: 'border-transparent bg-gray-100 text-gray-600'
												}`}>
													{playlist.isSynced ? 'Synced' : 'Not Synced'}
												</span>
											</td>
											<td className="p-4">
												<div className="flex items-center gap-2">
													<Button
														variant="outline"
														size="sm"
														onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.id}`, '_blank')}
														aria-label={`Open ${playlist.snippet?.title || 'Unknown Playlist'} on YouTube`}
													>
														<Icon name="link-2" className="h-4 w-4" />
													</Button>
													
													{playlist.isSynced ? (
														<Form method="post" className="inline">
															<input type="hidden" name="intent" value="remove-from-sync" />
															<input type="hidden" name="playlistId" value={playlist.id} />
															<Button
																type="submit"
																variant="outline"
																size="sm"
																className="text-destructive hover:text-destructive"
																aria-label={`Remove ${playlist.snippet?.title || 'Unknown Playlist'} from sync`}
															>
																<Icon name="trash" className="h-4 w-4" />
															</Button>
														</Form>
													) : (
														<Form method="post" className="inline">
															<input type="hidden" name="intent" value="add-to-sync" />
															<input type="hidden" name="playlistId" value={playlist.id} />
															<Button
																type="submit"
																size="sm"
																aria-label={`Add ${playlist.snippet?.title || 'Unknown Playlist'} to sync`}
															>
																<Icon name="plus" className="h-4 w-4 mr-2" />
																Add to Sync
															</Button>
														</Form>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>
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
