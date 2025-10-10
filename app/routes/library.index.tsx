import { 
	Table, 
	TableHeader, 
	TableBody, 
	TableColumn, 
	TableRow, 
	TableCell,
	Spinner,
	Button
} from '@heroui/react'
import { useInfiniteScroll } from '@heroui/use-infinite-scroll'
import { useAsyncList } from "@react-stately/data";
import { useState } from 'react'
import { data, NavLink } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { TrackListSkeleton } from '#app/components/ui/track-list-skeleton'
import { TrackListItem } from '#app/components/track-list-item'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/library.index.ts'

// Define the track type
type UserTrack = {
	id: string
	createdAt: Date
	track: {
		id: string
		title: string
		artist: string
		duration: number | null
		thumbnailUrl: string | null
		serviceUrl: string | null
		service?: {
			displayName: string
			logoUrl: string | null
		} | null
		audioFile?: {
			objectKey: string | null
			fileSize: number | null
			status: string
		} | null
	}
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const cursor = url.searchParams.get('cursor')
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '5')))

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
	// Ensure we have valid data structure
	const safeLoaderData = loaderData || { 
		userTracks: [], 
		pagination: { hasNext: false, nextCursor: null, limit: 5 } 
	}
	const { userTracks, pagination } = safeLoaderData

	const [hasMore, setHasMore] = useState(pagination?.hasNext || false)

	// Use AsyncList following HeroUI docs pattern
	const list = useAsyncList<UserTrack, string>({
		async load({ signal, cursor }) {
			if (cursor) {
				// Load more data from API
				const res = await fetch(`/api/user-tracks?cursor=${cursor}&limit=5`, { signal })
				const json = await res.json() as { userTracks: UserTrack[], pagination: { hasNext: boolean, nextCursor: string | null } }
				
				setHasMore(json.pagination.hasNext)
				return {
					items: json.userTracks,
					cursor: json.pagination.nextCursor || undefined,
				}
			} else {
				// Initial load from route data
				setHasMore(pagination?.hasNext || false)
				return {
					items: userTracks || [],
					cursor: pagination?.nextCursor || undefined,
				}
			}
		},
	})

	// Set up infinite scroll
	const [loaderRef, scrollerRef] = useInfiniteScroll({ 
		hasMore, 
		onLoadMore: list.loadMore
	})

	// Define columns for the table
	const columns = [
		{ key: 'number', label: '#' },
		{ key: 'title', label: 'Title' },
		{ key: 'artist', label: 'Artist' },
		{ key: 'duration', label: 'Duration' },
		{ key: 'actions', label: 'Actions' }
	]

	// Format duration helper
	const formatDuration = (seconds: number | null) => {
		if (!seconds) return '--:--'
		const minutes = Math.floor(seconds / 60)
		const remainingSeconds = Math.floor(seconds % 60)
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
	}

	// Show loading skeleton while data is being processed
	if (!userTracks || !Array.isArray(userTracks) || !pagination) {
		return (
			<div className="space-y-4">
				<TrackListSkeleton />
			</div>
		)
	}

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
			
			{list.items.length === 0 && !list.isLoading ? (
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
				<Table
					aria-label="Music library tracks"
					isHeaderSticky
					baseRef={scrollerRef}
					bottomContent={
						hasMore ? (
							<div className="flex w-full justify-center">
								<Spinner ref={loaderRef} />
							</div>
						) : null
					}
					classNames={{
						base: "max-h-[600px] overflow-scroll",
						table: "min-h-[200px]",
					}}
				>
					<TableHeader columns={columns}>
						{(column) => (
							<TableColumn key={column.key}>
								{column.label}
							</TableColumn>
						)}
					</TableHeader>
					<TableBody
						items={list.items}
						isLoading={list.isLoading}
						loadingContent={<Spinner label="Loading..." />}
						emptyContent="No tracks found"
					>
						{(item) => (
							<TableRow key={item.id}>
								<TableCell colSpan={5} className="p-0">
									<TrackListItem
										track={item.track}
										userTrack={item}
										index={list.items.indexOf(item)}
									/>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			)}
		</div>
	)
}
