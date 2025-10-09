import { data, NavLink } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/playlists.index.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const cursor = url.searchParams.get('cursor')
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '12')))

	const playlists = await prisma.userPlaylist.findMany({
		where: { ownerId: userId },
		select: {
			id: true,
			title: true,
			description: true,
			createdAt: true,
			updatedAt: true,
			tracks: {
				select: {
					id: true,
					position: true,
					track: {
						select: {
							id: true,
							title: true,
							artist: true,
						},
					},
				},
				orderBy: { position: 'asc' },
			},
		},
		orderBy: { updatedAt: 'desc' },
		take: limit,
		cursor: cursor ? { id: cursor } : undefined,
		skip: cursor ? 1 : undefined,
	})

	// Get next cursor for pagination
	const nextCursor = playlists.length === limit ? playlists[playlists.length - 1]?.id : null

	return data({ 
		playlists,
		pagination: {
			limit,
			hasNext: !!nextCursor,
			nextCursor,
		}
	})
}

export default function PlaylistsIndexRoute({ loaderData }: Route.ComponentProps) {
	const { playlists, pagination } = loaderData

	return (
		<>
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold">My Playlists</h1>
				<NavLink
					to="new"
					className={({ isActive }) =>
						cn(
							'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90',
							isActive && 'bg-primary/90',
						)
					}
				>
					<Icon name="plus" className="h-4 w-4" />
					Create Playlist
				</NavLink>
			</div>
			
			{playlists.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<Icon name="file-text" className="h-12 w-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-semibold mb-2">No playlists yet</h3>
					<p className="text-muted-foreground mb-4">
						Start organizing your music by creating your first playlist.
					</p>
					<NavLink
						to="new"
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
					>
						<Icon name="plus" className="h-4 w-4" />
						Create Your First Playlist
					</NavLink>
				</div>
			) : (
				<>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
						{playlists.map((playlist) => (
							<NavLink
								key={playlist.id}
								to={playlist.id}
								preventScrollReset
								prefetch="intent"
								className={({ isActive }) =>
									cn(
										'group relative rounded-lg border bg-card p-4 shadow-sm transition-all hover:shadow-md',
										isActive && 'ring-2 ring-primary',
									)
								}
							>
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-center mb-2">
										<Icon name="file-text" className="h-8 w-8 text-muted-foreground" />
									</div>
									<div className="text-center">
										<h3 className="font-medium text-sm line-clamp-2 mb-1">
											{playlist.title}
										</h3>
										{playlist.description && (
											<p className="text-xs text-muted-foreground line-clamp-2 mb-2">
												{playlist.description}
											</p>
										)}
										<p className="text-xs text-muted-foreground">
											{playlist.tracks.length} track{playlist.tracks.length !== 1 ? 's' : ''}
										</p>
									</div>
									<div className="text-xs text-muted-foreground text-center">
										{new Date(playlist.createdAt).toLocaleDateString()}
									</div>
								</div>
							</NavLink>
						))}
					</div>
					
					{/* Pagination */}
					{pagination.hasNext && (
						<div className="flex items-center justify-center mt-6">
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
				</>
			)}
		</>
	)
}