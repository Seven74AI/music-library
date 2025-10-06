import { data, Link, useLoaderData, type LoaderFunctionArgs } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'

export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserId(request)
	
	const services = await prisma.service.findMany({
		where: { isActive: true },
		orderBy: { displayName: 'asc' }
	})
	
	return data({ services })
}

export default function ServiceImportHub() {
	const { services } = useLoaderData<typeof loader>()

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
				<h1 className="text-3xl font-bold">Import Tracks</h1>
				<p className="text-muted-foreground mt-2">
					Import tracks from your favorite music services
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
				{services.map((service) => (
					<ServiceCard key={service.id} service={service} />
				))}
			</div>

			{/* Future Services Placeholder */}
			<div className="mt-12">
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

function ServiceCard({ service }: { service: { id: string; name: string; displayName: string; logoUrl?: string | null; baseUrl: string } }) {
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
				</CardTitle>
				<CardDescription>
					Import tracks from {service.displayName}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Button asChild className="w-full">
					<Link to={`/music/services/import/${service.name}`}>
						<Icon name="download" className="mr-2 h-4 w-4" />
						Import from {service.displayName}
					</Link>
				</Button>
			</CardContent>
		</Card>
	)
}
