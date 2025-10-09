import { formatDistanceToNow } from 'date-fns'
import { data, Link, useLoaderData, Await, type LoaderFunctionArgs } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'
import { hasValidYouTubeOAuth } from '#app/utils/youtube-oauth-validation.server'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	
	// Get counts instead of full data for better performance
	const [totalTracks, totalPlaylists, recentTracks, recentPlaylists] = await Promise.all([
		prisma.userTrack.count({ where: { userId } }),
		prisma.userPlaylist.count({ where: { ownerId: userId } }),
		prisma.userTrack.findMany({
			where: { userId },
			select: {
				id: true,
				createdAt: true,
				track: {
					select: {
						id: true,
						title: true,
						artist: true,
						service: {
							select: {
								name: true,
								displayName: true,
							}
						}
					}
				}
			},
			orderBy: { createdAt: 'desc' },
			take: 5, // Recent tracks for preview
		}),
		prisma.userPlaylist.findMany({
			where: { ownerId: userId },
			select: {
				id: true,
				title: true,
				updatedAt: true,
				tracks: {
					select: { id: true }
				}
			},
			orderBy: { updatedAt: 'desc' },
			take: 3, // Recent playlists for preview
		})
	])

	// Get YouTube service info
	const youtubeService = await prisma.service.findUnique({
		where: { name: YOUTUBE_SERVICE.NAME }
	})

	// Defer YouTube data loading for better performance
	const youtubeDataPromise = youtubeService ? (async () => {
		const servicePlaylistService = createServicePlaylistService()
		
		try {
			const [syncedPlaylists, hasValidOAuth] = await Promise.all([
				servicePlaylistService.getSyncedPlaylists(YOUTUBE_SERVICE.NAME, userId),
				hasValidYouTubeOAuth(userId)
			])
			
			return {
				hasYouTubeConnection: hasValidOAuth,
				youtubeStats: {
					totalPlaylists: syncedPlaylists.length,
					lastSync: syncedPlaylists.length > 0 ? syncedPlaylists[0]?.updatedAt : null
				},
				youtubePlaylists: syncedPlaylists.slice(0, 3) // Recent playlists for preview
			}
		} catch (error) {
			console.error('Error fetching YouTube data:', error)
			return {
				hasYouTubeConnection: false,
				youtubeStats: null,
				youtubePlaylists: []
			}
		}
	})() : Promise.resolve({
		hasYouTubeConnection: false,
		youtubeStats: null,
		youtubePlaylists: []
	})

	return data({
		stats: {
			totalTracks,
			totalPlaylists,
		},
		recentTracks,
		recentPlaylists,
		youtubeData: youtubeDataPromise
	})
}

export default function MusicDashboard() {
	const { stats, recentTracks, recentPlaylists, youtubeData } = useLoaderData<typeof loader>()

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<h1 className="text-3xl font-bold">Music Hub</h1>
				<p className="text-muted-foreground mt-2">
					Manage your music library, playlists, and connected services
				</p>
			</div>

			{/* Quick Actions */}
			<div className="mb-8">
				<h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
				<div className="flex flex-wrap gap-4">
					<Button asChild>
						<Link to="/music/services/youtube/import">
							<Icon name="download" className="h-4 w-4 mr-2" />
							Import Tracks
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/playlists/new">
							<Icon name="plus" className="h-4 w-4 mr-2" />
							Create Playlist
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/music/services/youtube">
							<Icon name="link-2" className="h-4 w-4 mr-2" />
							Manage YouTube
						</Link>
					</Button>
				</div>
			</div>

			{/* Quick Stats */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Tracks</CardTitle>
						<Icon name="file-text" className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats.totalTracks}</div>
						<p className="text-xs text-muted-foreground">
							<Link to="/library" className="hover:underline">
								View your library →
							</Link>
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">My Playlists</CardTitle>
						<Icon name="file-text" className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats.totalPlaylists}</div>
						<p className="text-xs text-muted-foreground">
							<Link to="/playlists" className="hover:underline">
								Manage playlists →
							</Link>
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">YouTube</CardTitle>
						<Icon name="link-2" className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<Await resolve={youtubeData}>
							{(youtubeData) => (
								<>
									<div className="text-2xl font-bold">
										{youtubeData.hasYouTubeConnection ? 'Connected' : 'Not Connected'}
									</div>
									<p className="text-xs text-muted-foreground">
										<Link to="/music/services/youtube" className="hover:underline">
											Manage YouTube →
										</Link>
									</p>
								</>
							)}
						</Await>
					</CardContent>
				</Card>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				{/* Recent Tracks */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Icon name="file-text" className="h-5 w-5" />
							Recent Tracks
						</CardTitle>
						<CardDescription>
							Your recently added tracks
						</CardDescription>
					</CardHeader>
					<CardContent>
						{recentTracks.length === 0 ? (
							<div className="text-center py-4 text-muted-foreground">
								<Icon name="file-text" className="h-8 w-8 mx-auto mb-2" />
								<p>No tracks yet</p>
								<Button asChild variant="outline" size="sm" className="mt-2">
									<Link to="/music/services/youtube/import">
										Import your first track
									</Link>
								</Button>
							</div>
						) : (
							<div className="space-y-3">
								{recentTracks.map((userTrack) => (
									<div key={userTrack.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
										<div className="flex-1 min-w-0">
											<p className="font-medium truncate">{userTrack.track.title}</p>
											<p className="text-sm text-muted-foreground truncate">
												{userTrack.track.artist}
											</p>
										</div>
										{userTrack.track.service && (
											<span className="text-xs text-muted-foreground">
												{userTrack.track.service.displayName}
											</span>
										)}
									</div>
								))}
								<div className="pt-2 border-t">
									<Button asChild variant="outline" size="sm" className="w-full">
										<Link to="/library">
											View All Tracks
										</Link>
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Recent Playlists */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Icon name="file-text" className="h-5 w-5" />
							Recent Playlists
						</CardTitle>
						<CardDescription>
							Your recently updated playlists
						</CardDescription>
					</CardHeader>
					<CardContent>
						{recentPlaylists.length === 0 ? (
							<div className="text-center py-4 text-muted-foreground">
								<Icon name="file-text" className="h-8 w-8 mx-auto mb-2" />
								<p>No playlists yet</p>
								<Button asChild variant="outline" size="sm" className="mt-2">
									<Link to="/playlists/new">
										Create your first playlist
									</Link>
								</Button>
							</div>
						) : (
							<div className="space-y-3">
								{recentPlaylists.map((playlist) => (
									<div key={playlist.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
										<div className="flex-1 min-w-0">
											<p className="font-medium truncate">{playlist.title}</p>
											<p className="text-sm text-muted-foreground">
												{playlist.tracks.length} tracks • {formatDistanceToNow(playlist.updatedAt, { addSuffix: true })}
											</p>
										</div>
									</div>
								))}
								<div className="pt-2 border-t">
									<Button asChild variant="outline" size="sm" className="w-full">
										<Link to="/playlists">
											View All Playlists
										</Link>
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* YouTube Service Status */}
			<Await resolve={youtubeData}>
				{(youtubeData) => (
					youtubeData.youtubeStats && (
						<div className="mt-8">
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Icon name="link-2" className="h-5 w-5" />
										YouTube Service
									</CardTitle>
									<CardDescription>
										Your YouTube playlists and sync status
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
										<div>
											<p className="text-sm text-muted-foreground">Synced Playlists</p>
											<p className="text-2xl font-bold">{youtubeData.youtubeStats.totalPlaylists}</p>
										</div>
										<div>
											<p className="text-sm text-muted-foreground">Last Sync</p>
											<p className="text-lg">
												{youtubeData.youtubeStats.lastSync 
													? formatDistanceToNow(youtubeData.youtubeStats.lastSync, { addSuffix: true })
													: 'Never'
												}
											</p>
										</div>
										<div>
											<p className="text-sm text-muted-foreground">Status</p>
											<p className="text-lg">
												{youtubeData.hasYouTubeConnection ? 'Connected' : 'Not Connected'}
											</p>
										</div>
									</div>
									
									{youtubeData.youtubePlaylists.length > 0 && (
										<div className="space-y-2 mb-4">
											<h4 className="font-medium">Recent YouTube Playlists</h4>
											{youtubeData.youtubePlaylists.map((playlist) => (
												<div key={playlist.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
													<div className="flex-1 min-w-0">
														<p className="font-medium truncate">{playlist.title}</p>
														<p className="text-sm text-muted-foreground">
															{playlist.itemCount} tracks
														</p>
													</div>
												</div>
											))}
										</div>
									)}
									
									<div className="flex gap-2">
										<Button asChild>
											<Link to="/music/services/youtube">
												Manage YouTube
											</Link>
										</Button>
										{!youtubeData.hasYouTubeConnection && (
											<Button asChild variant="outline">
												<Link to="/music/services/youtube/auth">
													Connect YouTube
												</Link>
											</Button>
										)}
									</div>
								</CardContent>
							</Card>
						</div>
					)
				)}
			</Await>
		</div>
	)
}
