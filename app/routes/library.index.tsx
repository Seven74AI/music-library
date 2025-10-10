import { data, NavLink } from 'react-router'
import { TrackAccordionItem } from '#app/components/track-accordion-item'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/library.index.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const cursor = url.searchParams.get('cursor')
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')))

	// Get user's tracks with cursor-based pagination
	const userTracks = await prisma.userTrack.findMany({
		where: { userId },
		select: {
			id: true,
			createdAt: true,
			track: {
				select: {
					id: true,
					title: true,
					artist: true,
					createdAt: true,
					updatedAt: true,
					service: {
						select: {
							name: true,
							displayName: true,
							logoUrl: true,
						}
					},
					serviceUrl: true,
					thumbnailUrl: true,
					duration: true,
					audioFile: {
						select: {
							id: true,
							objectKey: true,
							fileName: true,
							fileSize: true,
							mimeType: true,
							status: true,
							errorHistory: true,
							retryCount: true,
							downloadedAt: true,
							lastAttemptAt: true,
						},
					},
				},
			},
		},
		orderBy: { createdAt: 'desc' },
		take: limit,
		cursor: cursor ? { id: cursor } : undefined,
		skip: cursor ? 1 : undefined,
	})

	// Get next cursor for pagination
	const nextCursor = userTracks.length === limit ? userTracks[userTracks.length - 1]?.id : null

	return data({ 
		userTracks, 
		pagination: {
			limit,
			hasNext: !!nextCursor,
			nextCursor,
		}
	})
}

export default function LibraryIndexRoute({ loaderData }: Route.ComponentProps) {
	const { userTracks, pagination } = loaderData

	return (
		<div className="py-8">
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold">Music Library</h1>
				<div className="flex gap-2">
					<NavLink
						to="/music/services/youtube/import"
						className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-accent"
					>
						<Icon name="download" className="h-4 w-4" />
						Import Track
					</NavLink>
				</div>
			</div>
			
			{userTracks.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<Icon name="file-text" className="h-12 w-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-semibold mb-2">No tracks yet</h3>
					<p className="text-muted-foreground mb-4">
						Start building your music library by importing tracks from YouTube.
					</p>
					<NavLink
						to="/music/services/youtube/import"
						className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-accent"
					>
						<Icon name="download" className="h-4 w-4" />
						Import Track
					</NavLink>
				</div>
			) : (
				<div className="space-y-4">
					{/* Custom Accordion View - All Screen Sizes */}
					<div className="space-y-2">
						{userTracks.map((userTrack) => {
							const track = userTrack.track
							return (
								<TrackAccordionItem 
									key={track.id} 
									track={track} 
									userTrack={userTrack} 
								/>
							)
						})}
					</div>
					
					{/* Pagination */}
					{pagination.hasNext && (
						<div className="flex items-center justify-center px-4 py-3 border-t">
							<div className="flex items-center gap-2">
								<NavLink
									to={`?cursor=${pagination.nextCursor}&limit=${pagination.limit}`}
									className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-accent"
								>
									Next
									<Icon name="arrow-right" className="h-4 w-4" />
								</NavLink>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
