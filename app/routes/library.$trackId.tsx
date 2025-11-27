import { data, Link } from 'react-router'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getTrackTitle } from '#app/utils/breadcrumb-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { type Route } from './+types/library.$trackId.ts'

export const handle: BreadcrumbHandle = {
	breadcrumb: ({ data }) => getTrackTitle(data),
}

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireUserId(request)
	
	const track = await prisma.track.findUnique({
		where: { id: params.trackId },
		select: {
			id: true,
			title: true,
			artist: true,
			createdAt: true,
			updatedAt: true,
			duration: true,
		},
	})

	if (!track) {
		throw new Response('Track not found', { status: 404 })
	}

	return data({ track })
}

export default function TrackRoute({ loaderData }: Route.ComponentProps) {
	const { track } = loaderData

	return (
		<div className="py-8">
			<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Icon name="file-text" className="text-muted-foreground" />
					<h2 className="text-h2">{track.title}</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/library">
						<Icon name="arrow-left" className="mr-2" />
						Back
					</Link>
				</Button>
			</div>
					<div className="flex flex-col gap-6">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<h3 className="text-lg font-semibold mb-2">Track Information</h3>
								<div className="space-y-2">
									<div>
										<span className="text-sm font-medium text-muted-foreground">Title:</span>
										<p className="text-base">{track.title}</p>
									</div>
									<div>
										<span className="text-sm font-medium text-muted-foreground">Artist:</span>
										<p className="text-base">{track.artist}</p>
									</div>
									<div>
										<span className="text-sm font-medium text-muted-foreground">Duration:</span>
										<p className="text-base">
											{track.duration ? (
												formatDuration(track.duration)
											) : (
												<span className="text-muted-foreground flex items-center gap-1">
													<Icon name="clock" className="h-4 w-4" />
													Unknown
												</span>
											)}
										</p>
									</div>
									<div>
										<span className="text-sm font-medium text-muted-foreground">Added:</span>
										<p className="text-base">{new Date(track.createdAt).toLocaleDateString()}</p>
									</div>
								</div>
							</div>
						</div>
			</div>
		</div>
		</div>
	)
}
