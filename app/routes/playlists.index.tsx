import { data, NavLink } from 'react-router'
import { useState } from 'react'
import { Icon } from '#app/components/ui/icon.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#app/components/ui/select.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { PlaylistCard } from '#app/components/playlist-card'
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
							duration: true,
							thumbnailUrl: true,
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

type SortOption = 'name' | 'created' | 'updated' | 'tracks'
type ViewMode = 'grid' | 'list'

export default function PlaylistsIndexRoute({ loaderData }: Route.ComponentProps) {
	const { playlists, pagination } = loaderData
	const [searchQuery, setSearchQuery] = useState('')
	const [sortBy, setSortBy] = useState<SortOption>('updated')
	const [viewMode, setViewMode] = useState<ViewMode>('grid')

	// Filter and sort playlists
	const filteredPlaylists = playlists
		.filter(playlist => 
			playlist.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
			playlist.description?.toLowerCase().includes(searchQuery.toLowerCase())
		)
		.sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return a.title.localeCompare(b.title)
				case 'created':
					return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
				case 'updated':
					return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
				case 'tracks':
					return b.tracks.length - a.tracks.length
				default:
					return 0
			}
		})

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold">My Playlists</h1>
					<p className="text-muted-foreground">
						{filteredPlaylists.length} playlist{filteredPlaylists.length !== 1 ? 's' : ''}
					</p>
				</div>
				<NavLink
					to="new"
					className={({ isActive }) =>
						cn(
							'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors',
							isActive && 'bg-primary/90',
						)
					}
				>
					<Icon name="plus" className="h-4 w-4" />
					Create Playlist
				</NavLink>
			</div>

			{/* Controls */}
			<div className="flex flex-col sm:flex-row gap-4">
				{/* Search */}
				<div className="relative flex-1">
					<Icon name="magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search playlists..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9"
					/>
				</div>

				{/* Sort */}
				<Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
					<SelectTrigger className="w-full sm:w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="updated">Recently Updated</SelectItem>
						<SelectItem value="created">Recently Created</SelectItem>
						<SelectItem value="name">Name</SelectItem>
						<SelectItem value="tracks">Track Count</SelectItem>
					</SelectContent>
				</Select>

				{/* View Toggle */}
				<div className="flex rounded-lg border p-1">
					<Button
						variant={viewMode === 'grid' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setViewMode('grid')}
						className="h-8 w-8 p-0"
					>
						<Icon name="dots-horizontal" className="h-4 w-4" />
					</Button>
					<Button
						variant={viewMode === 'list' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setViewMode('list')}
						className="h-8 w-8 p-0"
					>
						<Icon name="list-bullet" className="h-4 w-4" />
					</Button>
				</div>
			</div>
			
			{/* Content */}
			{filteredPlaylists.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<Icon name="file-text" className="h-16 w-16 text-muted-foreground mb-4" />
					<h3 className="text-xl font-semibold mb-2">
						{searchQuery ? 'No playlists found' : 'No playlists yet'}
					</h3>
					<p className="text-muted-foreground mb-6 max-w-md">
						{searchQuery 
							? `No playlists match "${searchQuery}". Try a different search term.`
							: 'Start organizing your music by creating your first playlist.'
						}
					</p>
					{!searchQuery && (
						<NavLink
							to="new"
							className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
						>
							<Icon name="plus" className="h-5 w-5" />
							Create Your First Playlist
						</NavLink>
					)}
				</div>
			) : (
				<>
					{/* Playlists Grid/List */}
					<div className={cn(
						'grid gap-6',
						viewMode === 'grid' 
							? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
							: 'grid-cols-1'
					)}>
						{filteredPlaylists.map((playlist) => (
							<PlaylistCard
								key={playlist.id}
								id={playlist.id}
								title={playlist.title}
								description={playlist.description}
								tracks={playlist.tracks.map(pt => pt.track)}
								createdAt={playlist.createdAt.toISOString()}
								updatedAt={playlist.updatedAt.toISOString()}
							/>
						))}
					</div>
					
					{/* Pagination */}
					{pagination.hasNext && (
						<div className="flex items-center justify-center mt-8">
							<NavLink
								to={`?cursor=${pagination.nextCursor}&limit=${pagination.limit}`}
								className="inline-flex items-center gap-2 rounded-lg border px-6 py-3 hover:bg-accent transition-colors"
							>
								Load More
								<Icon name="arrow-right" className="h-4 w-4" />
							</NavLink>
						</div>
					)}
				</>
			)}
		</div>
	)
}