import { data, NavLink, Form } from 'react-router'
import { AddTrackModal } from '#app/components/add-track-modal.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
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
							fileName: true,
							fileSize: true,
							mimeType: true,
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
		<>
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold">Music Library</h1>
				<div className="flex gap-2">
					{userTracks.length > 0 && (
						<NavLink
							to="/music/services/youtube/import"
							className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-accent"
						>
							<Icon name="download" className="h-4 w-4" />
							Import Track
						</NavLink>
					)}
					<AddTrackModal />
				</div>
			</div>
			
			{userTracks.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<Icon name="file-text" className="h-12 w-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-semibold mb-2">No tracks yet</h3>
					<p className="text-muted-foreground mb-4">
						Start building your music library by adding your first track.
					</p>
					<div className="flex gap-2">
						<AddTrackModal />
						<NavLink
							to="/music/services/youtube/import"
							className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 hover:bg-accent"
						>
							<Icon name="download" className="h-4 w-4" />
							Import Track
						</NavLink>
					</div>
				</div>
			) : (
				<div className="rounded-md border">
					<table className="w-full">
						<thead>
							<tr className="border-b bg-muted/50">
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Track</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Artist</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Source</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Duration</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Added</th>
								<th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
							</tr>
						</thead>
						<tbody>
							{userTracks.map((userTrack) => {
								const track = userTrack.track
								return (
									<tr key={track.id} className="border-b transition-colors hover:bg-muted/50">
										<td className="p-4 align-middle">
											<div className="flex items-center gap-3">
												<div className="flex-shrink-0">
													{track.thumbnailUrl ? (
														<img 
															src={track.thumbnailUrl} 
															alt={track.title}
															className="h-10 w-10 rounded object-cover"
														/>
													) : track.audioFile ? (
														<div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
															<Icon name="file-text" className="h-5 w-5 text-muted-foreground" />
														</div>
													) : (
														<div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
															<Icon name="link-2" className="h-5 w-5 text-muted-foreground" />
														</div>
													)}
												</div>
												<div className="min-w-0 flex-1">
													<NavLink
														to={track.id}
														className="font-medium hover:underline truncate block"
														title={track.title}
													>
														{track.title}
													</NavLink>
												</div>
											</div>
										</td>
										<td className="p-4 align-middle">
											<span className="text-muted-foreground truncate block" title={track.artist}>
												{track.artist}
											</span>
										</td>
										<td className="p-4 align-middle">
											{track.service ? (
												<div className="flex items-center gap-2">
													{track.service.logoUrl ? (
														<img src={track.service.logoUrl} alt={track.service.displayName} className="w-4 h-4" />
													) : (
														<Icon name="link-2" className="w-4 h-4 text-muted-foreground" />
													)}
													<span className="text-sm text-muted-foreground">{track.service.displayName}</span>
												</div>
											) : (
												<span className="text-sm text-muted-foreground">Uploaded</span>
											)}
										</td>
										<td className="p-4 align-middle">
											{track.duration ? (
												<span className="text-sm text-muted-foreground">{formatDuration(track.duration)}</span>
											) : (
												<span className="text-sm text-muted-foreground">-</span>
											)}
										</td>
										<td className="p-4 align-middle">
											<span className="text-sm text-muted-foreground">
												{new Date(userTrack.createdAt).toLocaleDateString()}
											</span>
										</td>
										<td className="p-4 align-middle text-right">
											<Form method="post" action={`/library/${track.id}/remove`}>
												<button
													type="submit"
													className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8"
													onClick={(e) => {
														if (!confirm(`Remove "${track.title}" from your library?`)) {
															e.preventDefault()
														}
													}}
													title="Remove from library"
												>
													<Icon name="trash" className="h-4 w-4" />
												</button>
											</Form>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
					
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
		</>
	)
}
