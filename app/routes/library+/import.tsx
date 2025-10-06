import { data, Link, Outlet } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/import.ts'

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	
	const services = await prisma.service.findMany({
		where: { isActive: true },
		orderBy: { displayName: 'asc' }
	})
	
	return data({ services })
}

export default function ImportTracksPage({ loaderData }: Route.ComponentProps) {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Icon name="download" className="text-muted-foreground" />
					<h2 className="text-h2">Import Tracks</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/library">
						<Icon name="arrow-left" className="mr-2" />
						Back to Library
					</Link>
				</Button>
			</div>

			<div className="rounded-lg border bg-card p-6">
				<h3 className="text-lg font-semibold mb-4">Choose a Service</h3>
				<p className="text-muted-foreground mb-6">
					Import tracks from your favorite music services. Search and add tracks to your personal library.
				</p>
				
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{loaderData.services.map((service) => (
						<ServiceCard key={service.id} service={service} />
					))}
			</div>
		</div>
		<Outlet />
	</div>
	)
}

function ServiceCard({ service }: { service: { id: string; name: string; displayName: string; logoUrl?: string | null } }) {
	return (
		<Link to={`/library/import/${service.name}`}>
			<div className="flex items-center gap-4 p-4 border rounded-lg hover:bg-accent transition-colors">
				{service.logoUrl ? (
					<img 
						src={service.logoUrl} 
						alt={`${service.displayName} logo`}
						className="w-12 h-12 rounded"
					/>
				) : (
					<div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
						<Icon name="link-2" className="w-6 h-6" />
					</div>
				)}
				<div className="flex-1">
					<h4 className="font-semibold">{service.displayName}</h4>
					<p className="text-sm text-muted-foreground">Import from {service.displayName}</p>
				</div>
				<Icon name="arrow-right" className="w-4 h-4 text-muted-foreground" />
			</div>
		</Link>
	)
}
