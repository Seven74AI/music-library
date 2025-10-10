import { data, NavLink, Form } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { downloadTrack } from '#app/utils/download.ts'
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
		<>
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
					{/* Desktop Table View */}
					<div className="hidden lg:block rounded-md border overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full table-fixed">
						<thead>
							<tr className="border-b bg-muted/50">
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-1/3">Track</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-1/6">Artist</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-20">Source</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-20">Duration</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-24">Status</th>
								<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-24">Added</th>
								<th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground w-24">Actions</th>
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
														className="font-medium hover:underline truncate block max-w-full"
														title={track.title}
													>
														{track.title}
													</NavLink>
												</div>
											</div>
										</td>
										<td className="p-4 align-middle">
											<span className="text-muted-foreground truncate block max-w-full" title={track.artist}>
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
													<span className="text-sm text-muted-foreground truncate" title={track.service.displayName}>{track.service.displayName}</span>
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
											{track.audioFile ? (
												<div className="flex items-center gap-2">
													{track.audioFile.status === 'pending' ? (
														<Tooltip>
															<TooltipTrigger asChild>
																<span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">
																	Pending
																</span>
															</TooltipTrigger>
															<TooltipContent>
																<p>Track is in the processing queue and will be archived soon</p>
															</TooltipContent>
														</Tooltip>
													) : (
														<span className={`text-xs px-2 py-1 rounded ${
															track.audioFile.status === 'completed' ? 'bg-green-100 text-green-800' :
															track.audioFile.status === 'processing' ? 'bg-blue-100 text-blue-800' :
															'bg-red-100 text-red-800'
														}`}>
															{track.audioFile.status === 'completed' ? 'Ready' :
															 track.audioFile.status === 'processing' ? 'Processing' :
															 'Failed'}
														</span>
													)}
												</div>
											) : (
												<span className="text-sm text-muted-foreground">Not Archived</span>
											)}
										</td>
										<td className="p-4 align-middle">
											<span className="text-sm text-muted-foreground">
												{new Date(userTrack.createdAt).toLocaleDateString()}
											</span>
										</td>
										<td className="p-4 align-middle text-right">
											<div className="flex items-center gap-1 justify-end">
												{track.audioFile?.objectKey && (
													<button
														onClick={() => downloadTrack(track.id, `${track.title}.mp3`)}
														className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8"
														title="Download audio file"
													>
														<Icon name="download" className="h-4 w-4" />
													</button>
												)}
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
											</div>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
						</div>
					</div>

					{/* Mobile Card View */}
					<div className="lg:hidden space-y-3">
						{userTracks.map((userTrack) => {
							const track = userTrack.track
							return (
								<div key={track.id} className="border rounded-lg p-4 space-y-3">
									{/* Track Header */}
									<div className="flex items-start gap-3">
										<div className="flex-shrink-0">
											{track.thumbnailUrl ? (
												<img 
													src={track.thumbnailUrl} 
													alt={track.title}
													className="h-12 w-12 rounded object-cover"
												/>
											) : track.audioFile ? (
												<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
													<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
												</div>
											) : (
												<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
													<Icon name="link-2" className="h-6 w-6 text-muted-foreground" />
												</div>
											)}
										</div>
										<div className="min-w-0 flex-1">
											<NavLink
												to={track.id}
												className="font-medium hover:underline block text-sm leading-tight"
											>
												{track.title}
											</NavLink>
											<div className="text-xs text-muted-foreground mt-1">
												{track.artist}
											</div>
										</div>
										<div className="flex items-center gap-1">
											<NavLink
												to={track.id}
												className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8"
												title="View track details"
											>
												<Icon name="eye-open" className="h-4 w-4" />
											</NavLink>
											{track.audioFile?.objectKey && (
												<button
													onClick={() => downloadTrack(track.id, `${track.title}.mp3`)}
													className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8"
													title="Download audio file"
												>
													<Icon name="download" className="h-4 w-4" />
												</button>
											)}
										</div>
									</div>

									{/* Track Details */}
									<div className="grid grid-cols-2 gap-3 text-xs">
										<div>
											<span className="text-muted-foreground">Source:</span>
											<div className="font-medium">{track.service?.name || 'Unknown'}</div>
										</div>
										<div>
											<span className="text-muted-foreground">Duration:</span>
											<div className="font-medium">{formatDuration(track.duration || 0)}</div>
										</div>
										<div>
											<span className="text-muted-foreground">Added:</span>
											<div className="font-medium">{new Date(userTrack.createdAt).toLocaleDateString()}</div>
										</div>
										<div>
											<span className="text-muted-foreground">Status:</span>
											<div>
												{track.audioFile ? (
													track.audioFile.status === 'pending' ? (
														<Tooltip>
															<TooltipTrigger asChild>
																<span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">
																	Pending
																</span>
															</TooltipTrigger>
															<TooltipContent>
																<p>Track is in the processing queue and will be archived soon</p>
															</TooltipContent>
														</Tooltip>
													) : (
														<span className={`text-xs px-2 py-1 rounded ${
															track.audioFile.status === 'completed' ? 'bg-green-100 text-green-800' :
															track.audioFile.status === 'processing' ? 'bg-blue-100 text-blue-800' :
															'bg-red-100 text-red-800'
														}`}>
															{track.audioFile.status === 'completed' ? 'Ready' :
															 track.audioFile.status === 'processing' ? 'Processing' :
															 'Failed'}
														</span>
													)
												) : (
													<span className="text-xs text-muted-foreground">Not Archived</span>
												)}
											</div>
										</div>
									</div>
								</div>
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
		</>
	)
}
