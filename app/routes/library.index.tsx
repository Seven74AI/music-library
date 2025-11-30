import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import { useCallback, useEffect, useRef } from 'react'
import { data } from 'react-router'
import { TrackListItem } from '#app/components/track-list-item'
import { Icon } from '#app/components/ui/icon.tsx'
import { ScrollArea } from '#app/components/ui/scroll-area'
import { TrackListSkeleton } from '#app/components/ui/track-list-skeleton'
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
		artist: {
			id: string
			name: string
		}
		duration: number | null
		coverImage: {
			objectKey: string
		} | null
		serviceUrl: string | null
		service?: {
			displayName: string
			logoUrl: string | null
		} | null
		audioFiles?: Array<{
			id: string
			format: string | null
			objectKey: string
		}>
	}
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const cursor = url.searchParams.get('cursor')
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '5')))

	// Get user's tracks with cursor-based pagination
	const userTracksRaw = await prisma.userTrack.findMany({
		where: { userId },
		select: {
			id: true,
			createdAt: true,
			track: {
				select: {
					id: true,
					title: true,
					artist: {
						select: {
							id: true,
							name: true,
						},
					},
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
					coverImage: {
						select: {
							objectKey: true,
						},
					},
					duration: true,
					audioFiles: {
						select: {
							id: true,
							format: true,
							objectKey: true,
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

	// Return tracks with relations (no transformations needed)
	const userTracks = userTracksRaw

	// Get next cursor for pagination
	const nextCursor = userTracks.length === limit ? userTracks[userTracks.length - 1]?.id : null

	// Add playlists to loader
	const playlists = await prisma.userPlaylist.findMany({
		where: { ownerId: userId },
		select: {
			id: true,
			title: true,
			description: true,
			_count: {
				select: { tracks: true }
			}
		},
		orderBy: { updatedAt: 'desc' }
	})

	return data({
		userTracks,
		pagination: {
			limit,
			hasNext: !!nextCursor,
			nextCursor,
		},
		playlists
	})
}

export default function LibraryIndexRoute({ loaderData }: Route.ComponentProps) {
	// Ensure we have valid data structure
	const safeLoaderData = loaderData || {
		userTracks: [],
		pagination: { hasNext: false, nextCursor: null, limit: 5 },
		playlists: []
	}
	const { userTracks, pagination, playlists } = safeLoaderData

	// Use useInfiniteQuery for data fetching
	const {
		data: queryData,
		error,
		fetchNextPage,
		hasNextPage,
		isFetching,
		isFetchingNextPage,
		isPending,
		status,
	} = useInfiniteQuery({
		queryKey: ['user-tracks'],
		queryFn: async ({ pageParam }) => {
			const url = pageParam 
				? `/api/user-tracks?cursor=${pageParam}&limit=5`
				: `/api/user-tracks?limit=5`
			const res = await fetch(url)
			const json = await res.json() as { userTracks: UserTrack[], pagination: { hasNext: boolean, nextCursor: string | null } }
			return json
		},
		getNextPageParam: (lastPage) => lastPage.pagination.nextCursor || undefined,
		initialPageParam: pagination?.nextCursor || undefined,
		initialData: {
			pages: [{ userTracks: userTracks || [], pagination: { hasNext: pagination?.hasNext || false, nextCursor: pagination?.nextCursor || null } }],
			pageParams: [pagination?.nextCursor || undefined],
		},
	})

	// Flatten all pages into a single array
	const allItems = queryData?.pages.flatMap(page => page.userTracks) || []

	// Virtualization setup with sticky header support
	const parentRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: 1 + allItems.length + (hasNextPage ? 1 : 0), // 1 for header + items + 1 for loading indicator
		getScrollElement: () => parentRef.current?.querySelector('[data-radix-scroll-area-viewport]') || null,
		estimateSize: () => 64, // Fixed track item size
		overscan: 5, // Render 5 extra items outside viewport
		rangeExtractor: useCallback((range: Range) => {
			const next = new Set([0, ...defaultRangeExtractor(range)])
			return [...next].sort((a, b) => a - b)
		}, []),
	})

	// Monitor when last virtual item is rendered for infinite scroll
	const virtualItems = virtualizer.getVirtualItems()
	useEffect(() => {
		const [lastItem] = [...virtualItems].reverse()
		
		if (!lastItem) return
		
		// When last virtual item index >= last data index - 1, fetch more
		if (
			lastItem.index >= allItems.length &&
			hasNextPage &&
			!isFetchingNextPage
		) {
			void (async () => {
				try {
					await fetchNextPage()
				} catch (error) {
					console.error('Failed to fetch next page:', error)
				}
			})()
		}
	}, [
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		virtualItems,
		allItems.length,
	])




	// Show loading skeleton while data is being processed
	if (isPending) {
		return (
			<div className="space-y-4">
				<TrackListSkeleton />
			</div>
		)
	}

	// Show error state
	if (status === 'error') {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<Icon name="x-mark" className="h-12 w-12 text-destructive mb-4" />
				<h3 className="text-lg font-semibold mb-2">Error loading tracks</h3>
				<p className="text-muted-foreground mb-4">
					{error instanceof Error ? error.message : 'Something went wrong'}
				</p>
			</div>
		)
	}

	return (
		<div className="py-8">
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold">Music Library</h1>
			</div>

			{allItems.length === 0 && !isFetching ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<Icon name="file-text" className="h-12 w-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-semibold mb-2">No tracks yet</h3>
					<p className="text-muted-foreground mb-4">
						Start building your music library by uploading tracks.
					</p>
				</div>
			) : (
				<div className="h-[600px] w-full">
					{/* Virtualized Content with Sticky Header */}
					<ScrollArea className="h-full w-full" ref={parentRef}>
						<div
							style={{
								height: `${virtualizer.getTotalSize()}px`,
								width: '100%',
								position: 'relative',
							}}
						>
							{virtualizer.getVirtualItems().map((virtualItem) => {
								const isHeader = virtualItem.index === 0
								
								if (isHeader) {
									return (
										<div
											key="header"
											style={{
												position: 'sticky',
												top: 0,
												zIndex: 10,
												height: `${virtualItem.size}px`,
												transform: `translateY(${virtualItem.start}px)`,
											}}
											className="bg-background border-b"
										>
											<div className="flex items-center gap-4 px-4 py-3 text-sm font-medium text-muted-foreground">
												<div className="w-8 flex items-center justify-center min-w-8">#</div>
												<div className="flex-1 min-w-0">Title</div>
												<div className="hidden lg:flex items-center justify-center w-20">Saved</div>
												<div className="hidden md:flex text-xs text-muted-foreground w-12 text-center">Duration</div>
												<div className="flex items-center gap-1 w-8">Actions</div>
											</div>
										</div>
									)
								}
								
								// Adjust index for actual items (skip header)
								const itemIndex = virtualItem.index - 1
								
								if (itemIndex >= allItems.length) {
									// Loading indicator
									return (
										<div
											key="loading"
											style={{
												position: 'absolute',
												top: 0,
												left: 0,
												width: '100%',
												height: `${virtualItem.size}px`,
												transform: `translateY(${virtualItem.start}px)`,
											}}
										>
											<div className="flex w-full justify-center py-4">
												{isFetchingNextPage ? (
													<Icon name="update" className="h-6 w-6 animate-spin" />
												) : hasNextPage ? (
													'Loading more...'
												) : (
													'Nothing more to load'
												)}
											</div>
										</div>
									)
								}

								const item = allItems[itemIndex]
								if (!item) return null
								
								return (
									<div
										key={item.id}
										style={{
											position: 'absolute',
											top: 0,
											left: 0,
											width: '100%',
											height: `${virtualItem.size}px`,
											transform: `translateY(${virtualItem.start}px)`,
										}}
									>
										<TrackListItem
											track={item.track}
											userTrack={item}
											index={itemIndex}
											playlists={playlists}
										/>
									</div>
								)
							})}
						</div>
					</ScrollArea>
				</div>
			)}
		</div>
	)
}
