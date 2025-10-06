import { data, Link } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { createYouTubePlaylistService } from '#app/utils/youtube-playlist.server'
import { type Route } from './+types/index.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	
	// Get all active services
	const services = await prisma.service.findMany({
		where: { isActive: true },
		orderBy: { displayName: 'asc' }
	})

	// Get YouTube connection status
	let youtubeConnectionStatus = null
	const youtubeService = services.find(s => s.name === 'youtube')
	
	if (youtubeService) {
		const youtubePlaylistService = createYouTubePlaylistService()
		try {
			const [storedTokens, syncStatus] = await Promise.all([
				youtubePlaylistService.getStoredTokens(userId),
				youtubePlaylistService.getSyncStatus(userId)
			])
			
			youtubeConnectionStatus = {
				connected: !!storedTokens,
				syncStatus
			}
		} catch (error) {
			console.error('Error fetching YouTube status:', error)
			youtubeConnectionStatus = { connected: false, syncStatus: null }
		}
	}

	return data({ services, youtubeConnectionStatus })
}

export default function ServicesHub({ loaderData }: Route.ComponentProps) {
	const { services, youtubeConnectionStatus } = loaderData

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music">
							<Icon name="arrow-left" className="mr-2" />
							Back to Music Hub
						</Link>
					</Button>
				</div>
				<h1 className="text-3xl font-bold">Connected Services</h1>
				<p className="text-muted-foreground mt-2">
					Manage your music service connections and integrations
				</p>
			</div>

			{/* Active Services */}
			<div className="mb-8">
				<h2 className="text-xl font-semibold mb-4">Available Services</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{services.map((service) => (
						<ServiceCard 
							key={service.id} 
							service={service} 
							connectionStatus={service.name === 'youtube' ? youtubeConnectionStatus : null}
						/>
					))}
				</div>
			</div>

			{/* Quick Actions */}
			<div className="mb-8">
				<h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
				<div className="flex flex-wrap gap-4">
					<Button asChild>
						<Link to="/music/services/import">
							<Icon name="download" className="h-4 w-4 mr-2" />
							Import Tracks
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/library">
							<Icon name="file-text" className="h-4 w-4 mr-2" />
							View My Library
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/playlists">
							<Icon name="file-text" className="h-4 w-4 mr-2" />
							Manage Playlists
						</Link>
					</Button>
				</div>
			</div>

			{/* Coming Soon Services */}
			<div>
				<h2 className="text-xl font-semibold mb-4">Coming Soon</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					<Card className="opacity-50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<div className="w-8 h-8 bg-green-500 rounded flex items-center justify-center">
									<span className="text-white font-bold text-sm">S</span>
								</div>
								Spotify
							</CardTitle>
							<CardDescription>
								Import your Spotify playlists and library
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button disabled className="w-full">
								Coming Soon
							</Button>
						</CardContent>
					</Card>

					<Card className="opacity-50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<div className="w-8 h-8 bg-pink-500 rounded flex items-center justify-center">
									<span className="text-white font-bold text-sm">AM</span>
								</div>
								Apple Music
							</CardTitle>
							<CardDescription>
								Import your Apple Music library and playlists
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button disabled className="w-full">
								Coming Soon
							</Button>
						</CardContent>
					</Card>

					<Card className="opacity-50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center">
									<span className="text-white font-bold text-sm">SC</span>
								</div>
								SoundCloud
							</CardTitle>
							<CardDescription>
								Import tracks and playlists from SoundCloud
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button disabled className="w-full">
								Coming Soon
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}

function ServiceCard({ 
	service, 
	connectionStatus 
}: { 
	service: { id: string; name: string; displayName: string; logoUrl?: string | null; baseUrl: string }
	connectionStatus: { connected: boolean; syncStatus: any } | null
}) {
	const isConnected = connectionStatus?.connected || false
	const syncStatus = connectionStatus?.syncStatus

	return (
		<Card className="hover:shadow-md transition-shadow">
			<CardHeader>
				<CardTitle className="flex items-center gap-3">
					{service.logoUrl ? (
						<img 
							src={service.logoUrl} 
							alt={`${service.displayName} logo`}
							className="w-8 h-8 rounded"
						/>
					) : (
						<div className="w-8 h-8 bg-muted rounded flex items-center justify-center">
							<Icon name="link-2" className="w-4 h-4" />
						</div>
					)}
					{service.displayName}
					<div className={`w-3 h-3 rounded-full ml-auto ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
				</CardTitle>
				<CardDescription>
					{isConnected ? 'Connected' : 'Not connected'}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{isConnected && syncStatus && (
					<div className="text-sm text-muted-foreground">
						<p>{syncStatus.totalPlaylists} playlists synced</p>
						{syncStatus.lastSync && (
							<p>Last sync: {new Date(syncStatus.lastSync).toLocaleDateString()}</p>
						)}
					</div>
				)}
				
				<div className="flex gap-2">
					{isConnected ? (
						<>
							<Button asChild className="flex-1">
								<Link to={`/music/services/${service.name}`}>
									Manage
								</Link>
							</Button>
							<Button asChild variant="outline" size="sm">
								<Link to={`/music/services/import/${service.name}`}>
									<Icon name="download" className="h-4 w-4" />
								</Link>
							</Button>
						</>
					) : (
						<Button asChild className="w-full">
							<Link to={`/music/services/${service.name}/auth`}>
								<Icon name="link-2" className="h-4 w-4 mr-2" />
								Connect
							</Link>
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
