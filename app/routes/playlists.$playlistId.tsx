// @context7: Prisma, React, React Router, Tailwind CSS, TypeScript
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - Prisma
    - React
    - React Router
    - Tailwind CSS
    - TypeScript
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)

    Context7 Instructions:
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
import { useState, useEffect } from 'react'
import { data, redirect, Link, useFetcher, useParams } from 'react-router'
import { useAudioPlayer } from '#app/components/audio-player-provider.tsx'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { OfflinePlaylistDownloadButton } from '#app/components/offline/offline-playlist-download-button.tsx'
import { OfflinePlaylistView } from '#app/components/offline/offline-playlist-view.tsx'
import { PlaylistHero } from '#app/components/playlist-hero'
import { RouteHydrateFallback } from '#app/components/route-hydrate-fallback.tsx'
import { SortableTrackList } from '#app/components/sortable-track-list'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '#app/components/ui/alert-dialog'
import { Icon } from '#app/components/ui/icon.tsx'
import { toast } from '#app/components/ui/use-toast.ts'
import {
	defineOfflineClientLoader,
} from '#app/features/offline-app/define-offline-client-loader.ts'
import { type ServerLoaderData } from '#app/features/offline-app/offline-loader.client.ts'
import {
	type PlaylistDetailOfflineLoaderData,
} from '#app/features/offline-app/offline-route-policies.client.ts'
import {
	cachePlaylistMetadata,
} from '#app/features/offline-storage/offline-playlist-metadata.client.ts'
import { type FullTrack } from '#app/types/frontend/shared.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getPlaylistTitle } from '#app/utils/breadcrumb-utils.ts'
import { chunkArray } from '#app/utils/chunk-array.ts'
import { prisma } from '#app/utils/db.server.ts'
import { filterPlayableTracks } from '#app/utils/playable-track.ts'
import { proxyClientActionToServer } from '#app/utils/server-proxy-client-action.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { userPlaylistTitleTaken } from '#app/utils/user-playlist.server.ts'
import { type Route } from './+types/playlists.$playlistId.ts'

export const handle: BreadcrumbHandle = {
	breadcrumb: ({ loaderData }) => getPlaylistTitle(loaderData),
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const playlist = await prisma.userPlaylist.findFirst({
		where: { 
			id: params.playlistId,
			ownerId: userId,
		},
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
							artist: {
								select: {
									id: true,
									name: true,
								},
							},
							duration: true,
							coverImage: {
								select: {
									objectKey: true,
								},
							},
							serviceUrl: true,
							createdAt: true,
							service: {
								select: {
									displayName: true,
									logoUrl: true,
								}
							},
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
				orderBy: { position: 'asc' },
			},
		},
	})

	if (!playlist) {
		throw new Response('Playlist not found', { status: 404 })
	}

	// Get user's library track IDs for isInUserLibrary status
	// Scoped to only the track IDs in this playlist (not the entire library)
	const playlistTrackIds = playlist.tracks.map((pt) => pt.track.id)
	const libraryTrackIds = new Set(
		playlistTrackIds.length > 0
			? (
					await prisma.userTrack.findMany({
						where: {
							userId,
							isActive: true,
							trackId: { in: playlistTrackIds },
						},
						select: { trackId: true },
					})
				).map((ut) => ut.trackId)
			: [],
	)

	// Add isInUserLibrary to each track
	const tracksWithLibraryStatus = playlist.tracks.map((pt) => ({
		...pt,
		track: {
			...pt.track,
			isInUserLibrary: libraryTrackIds.has(pt.track.id),
		},
	}))

	// Get user's playlists for TrackListItem component
	const userPlaylists = await prisma.userPlaylist.findMany({
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

	return data({ playlist: { ...playlist, tracks: tracksWithLibraryStatus }, playlists: userPlaylists })
}

export const clientLoader = defineOfflineClientLoader<
	ServerLoaderData<typeof loader>,
	PlaylistDetailOfflineLoaderData
>('routes/playlists.$playlistId')

export function HydrateFallback() {
	return <RouteHydrateFallback />
}

export async function action({ request, params }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'delete') {
		await prisma.userPlaylist.delete({
			where: { 
				id: params.playlistId,
				ownerId: userId,
			},
		})
		return redirect('/playlists')
	}

	if (intent === 'update') {
		const title = formData.get('title')
		const description = formData.get('description')

		if (typeof title !== 'string' || !title.trim()) {
			return data(
				{ error: 'Title is required' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Title is required',
						type: 'error',
					}),
				}
			)
		}

		if (typeof description !== 'string') {
			return data(
				{ error: 'Description must be a string' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Description must be a string',
						type: 'error',
					}),
				}
			)
		}

		const duplicate = await userPlaylistTitleTaken({
			userId,
			title: title.trim(),
			excludePlaylistId: params.playlistId,
		})

		if (duplicate.taken) {
			return data(
				{ error: `You already have a playlist named "${duplicate.existingTitle}"` },
				{
					status: 409,
					headers: await createToastHeaders({
						title: 'Duplicate playlist',
						description: `You already have a playlist named "${duplicate.existingTitle}"`,
						type: 'error',
					}),
				}
			)
		}

		await prisma.userPlaylist.update({
			where: { 
				id: params.playlistId,
				ownerId: userId,
			},
			data: {
				title: title.trim(),
				description: description.trim() || null,
			},
		})

		return data(
			{ success: true, message: 'Playlist updated successfully' },
			{
				headers: await createToastHeaders({
					title: 'Success',
					description: 'Playlist updated successfully',
					type: 'success',
				}),
			}
		)
	}

	if (intent === 'reorder') {
		const trackOrder = formData.get('trackOrder')
		
		if (typeof trackOrder !== 'string') {
			return data({ error: 'Track order is required' }, { status: 400 })
		}

		try {
			const orderData = JSON.parse(trackOrder) as Array<{ id: string; position: number }>
			
			// Update all track positions in a transaction
			await prisma.$transaction(
				orderData.map(({ id, position }) =>
					prisma.userPlaylistTrack.update({
						where: {
							id: id,
							playlist: {
								ownerId: userId,
								id: params.playlistId,
							},
						},
						data: { position },
					})
				)
			)

			return data(
				{ success: true, message: 'Tracks reordered successfully' },
				{
					headers: await createToastHeaders({
						title: 'Success',
						description: 'Tracks reordered successfully',
						type: 'success',
					}),
				}
			)
		} catch {
			return data(
				{ error: 'Invalid track order data' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Invalid track order data',
						type: 'error',
					}),
				}
			)
		}
	}

	if (intent === 'remove-track') {
		const trackId = formData.get('trackId')
		
		if (typeof trackId !== 'string') {
			return data(
				{ error: 'Track ID is required' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Track ID is required',
						type: 'error',
					}),
				}
			)
		}

		// First verify the playlist track exists and belongs to the user
		const playlistTrack = await prisma.userPlaylistTrack.findFirst({
			where: {
				id: trackId,
				playlist: {
					ownerId: userId,
					id: params.playlistId,
				},
			},
		})

		if (!playlistTrack) {
			return data(
				{ error: 'Track not found in playlist' },
				{
					status: 404,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Track not found in playlist',
						type: 'error',
					}),
				}
			)
		}

		// Delete the playlist track
		await prisma.userPlaylistTrack.delete({
			where: {
				id: trackId,
			},
		})

		return data(
			{ success: true, message: 'Track removed successfully' },
			{
				headers: await createToastHeaders({
					title: 'Success',
					description: 'Track removed successfully',
					type: 'success',
				}),
			}
		)
	}

	if (intent === 'bulk-remove-tracks') {
		const trackIds = formData.get('trackIds')
		
		if (typeof trackIds !== 'string') {
			return data(
				{ error: 'Track IDs are required' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Track IDs are required',
						type: 'error',
					}),
				}
			)
		}

		try {
			const trackIdArray = JSON.parse(trackIds) as string[]
			
			if (!Array.isArray(trackIdArray) || trackIdArray.length === 0) {
				return data(
					{ error: 'Invalid track IDs format' },
					{
						status: 400,
						headers: await createToastHeaders({
							title: 'Error',
							description: 'Invalid track IDs format',
							type: 'error',
						}),
					}
				)
			}

			// First verify all playlist tracks exist and belong to the user
			const playlistTracks = []
			for (const idChunk of chunkArray(trackIdArray)) {
				const batch = await prisma.userPlaylistTrack.findMany({
					where: {
						id: { in: idChunk },
						playlist: {
							ownerId: userId,
							id: params.playlistId,
						},
					},
				})
				playlistTracks.push(...batch)
			}

			if (playlistTracks.length !== trackIdArray.length) {
				return data(
					{ error: 'Some tracks not found in playlist' },
					{
						status: 404,
						headers: await createToastHeaders({
							title: 'Error',
							description: 'Some tracks not found in playlist',
							type: 'error',
						}),
					}
				)
			}

			// Delete all playlist tracks
			for (const idChunk of chunkArray(trackIdArray)) {
				await prisma.userPlaylistTrack.deleteMany({
					where: {
						id: { in: idChunk },
					},
				})
			}

			return data(
				{ success: true, message: `${trackIdArray.length} tracks removed successfully` },
				{
					headers: await createToastHeaders({
						title: 'Success',
						description: `${trackIdArray.length} tracks removed successfully`,
						type: 'success',
					}),
				}
			)
		} catch {
			return data(
				{ error: 'Invalid track IDs format' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Invalid track IDs format',
						type: 'error',
					}),
				}
			)
		}
	}

	return data(
		{ error: 'Invalid intent' },
		{
			status: 400,
			headers: await createToastHeaders({
				title: 'Error',
				description: 'Invalid intent',
				type: 'error',
			}),
		}
	)
}

export async function clientAction(args: Route.ClientActionArgs) {
	return proxyClientActionToServer(args)
}

export default function PlaylistRoute({ loaderData }: Route.ComponentProps) {
	if ('offline' in loaderData && loaderData.offline === true) {
		return (
			<OfflinePlaylistView
				playlistId={loaderData.offlinePlaylistMeta.id}
				title={loaderData.offlinePlaylistMeta.title}
				description={loaderData.offlinePlaylistMeta.description}
				tracks={loaderData.offlineTracks}
			/>
		)
	}

	return (
		<OnlinePlaylistRoute
			loaderData={
				loaderData as Extract<
					Route.ComponentProps['loaderData'],
					{ playlist: object }
				>
			}
		/>
	)
}

type OnlinePlaylistLoaderData = Extract<
	Route.ComponentProps['loaderData'],
	{ playlist: object }
>

function OnlinePlaylistRoute({
	loaderData,
}: {
	loaderData: OnlinePlaylistLoaderData
}) {
	const params = useParams()
	const { playlist, playlists } = loaderData
	
	// Audio player context (audio playback disabled)
	const { playNextTrack, addToUpNext, addToQueue } = useAudioPlayer()
	
	// Fetchers for progressive enhancement
	const reorderFetcher = useFetcher()
	const removeTrackFetcher = useFetcher()
	const updateFetcher = useFetcher()
	
	// Optimistic state for tracks
	const [optimisticTracks, setOptimisticTracks] = useState(playlist.tracks)
	const [optimisticPlaylist, setOptimisticPlaylist] = useState(playlist)
	
	// Update optimistic state when loader data changes
	useEffect(() => {
		setOptimisticTracks(playlist.tracks)
		setOptimisticPlaylist(playlist)
		cachePlaylistMetadata({
			id: playlist.id,
			title: playlist.title,
			description: playlist.description,
			updatedAt: Date.now(),
		})
	}, [playlist])

	// Handle success messages from fetchers
	// Fetcher data changes are handled by toast notifications, no need for console logs

	const handleTitleUpdate = (newTitle: string) => {
		// Optimistic update
		setOptimisticPlaylist(prev => ({ ...prev, title: newTitle }))
		
		// Submit with fetcher
		void updateFetcher.submit(
			{
				intent: 'update',
				title: newTitle,
				description: optimisticPlaylist.description || ''
			},
			{ method: 'post' }
		)
	}

	const handleDescriptionUpdate = (newDescription: string) => {
		// Optimistic update
		setOptimisticPlaylist(prev => ({ ...prev, description: newDescription }))
		
		// Submit with fetcher
		void updateFetcher.submit(
			{
				intent: 'update',
				title: optimisticPlaylist.title,
				description: newDescription
			},
			{ method: 'post' }
		)
	}

	const [bulkQueueDialogAction, setBulkQueueDialogAction] = useState<
		'playNext' | 'addToUpNext' | 'addToQueue' | null
	>(null)

	const bulkQueueActionLabels = {
		playNext: 'Play next',
		addToUpNext: 'Add to up next',
		addToQueue: 'Add to queue',
	} as const

	const applyBulkQueueAction = (
		tracks: FullTrack[],
		action: 'playNext' | 'addToUpNext' | 'addToQueue',
	) => {
		if (tracks.length === 0) return

		if (action === 'playNext') {
			for (const track of [...tracks].reverse()) {
				playNextTrack(track)
			}
			return
		}

		if (action === 'addToUpNext') {
			for (const track of tracks) {
				addToUpNext(track)
			}
			return
		}

		for (const track of tracks) {
			addToQueue(track)
		}
	}

	const showBulkQueueToast = (
		playableCount: number,
		skippedCount: number,
		action: 'playNext' | 'addToUpNext' | 'addToQueue',
	) => {
		const actionLabel = bulkQueueActionLabels[action].toLowerCase()
		toast({
			title: 'Success',
			description: skippedCount > 0
				? `${playableCount} track(s) ${actionLabel} (${skippedCount} skipped — no audio)`
				: `${playableCount} track(s) ${actionLabel}`,
			variant: 'success',
		})
	}

	const handleBulkPlayNext = () => {
		setBulkQueueDialogAction('playNext')
	}

	const handleBulkAddToUpNext = () => {
		setBulkQueueDialogAction('addToUpNext')
	}

	const handleBulkAddToQueue = () => {
		setBulkQueueDialogAction('addToQueue')
	}

	const confirmBulkQueueAction = () => {
		if (!bulkQueueDialogAction) return

		const tracks = optimisticTracks.map(pt => pt.track as FullTrack)
		const playable = filterPlayableTracks(tracks)
		applyBulkQueueAction(playable, bulkQueueDialogAction)

		const skippedCount = tracks.length - playable.length
		showBulkQueueToast(playable.length, skippedCount, bulkQueueDialogAction)
		setBulkQueueDialogAction(null)
	}


	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
	const [isBulkRemoveDialogOpen, setIsBulkRemoveDialogOpen] = useState(false)
	const [tracksToRemove, setTracksToRemove] = useState<string[]>([])

	const handleDelete = () => {
		setIsDeleteDialogOpen(true)
	}

	const confirmDelete = () => {
		const formData = new FormData()
		formData.append('intent', 'delete')
		
		const form = document.createElement('form')
		form.method = 'post'
		form.style.display = 'none'
		
		const input = document.createElement('input')
		input.type = 'hidden'
		input.name = 'intent'
		input.value = 'delete'
		form.appendChild(input)
		
		document.body.appendChild(form)
		form.submit()
	}

	const handleReorder = (newOrder: Array<{ id: string; position: number }>) => {
		// Optimistic update - reorder tracks immediately
		const reorderedTracks = [...optimisticTracks].sort((a, b) => {
			const aOrder = newOrder.find(order => order.id === a.id)?.position || 0
			const bOrder = newOrder.find(order => order.id === b.id)?.position || 0
			return aOrder - bOrder
		})
		setOptimisticTracks(reorderedTracks)
		
		// Submit with fetcher
		void reorderFetcher.submit(
			{
				intent: 'reorder',
				trackOrder: JSON.stringify(newOrder)
			},
			{ method: 'post' }
		)
	}

	const handleRemoveTrack = (playlistTrackId: string) => {
		// Optimistic update - remove track immediately
		setOptimisticTracks(prev => prev.filter(playlistTrack => playlistTrack.id !== playlistTrackId))
		
		// Submit with fetcher
		void removeTrackFetcher.submit(
			{
				intent: 'remove-track',
				trackId: playlistTrackId
			},
			{ method: 'post' }
		)
	}

	const handleBulkRemove = (playlistTrackIds: string[]) => {
		// Store tracks to remove and open confirmation dialog
		setTracksToRemove(playlistTrackIds)
		setIsBulkRemoveDialogOpen(true)
	}

	const confirmBulkRemove = () => {
		// Optimistic update - remove all tracks immediately
		setOptimisticTracks(prev => prev.filter(playlistTrack => !tracksToRemove.includes(playlistTrack.id)))
		
		// Submit bulk removal with fetcher
		void removeTrackFetcher.submit(
			{
				intent: 'bulk-remove-tracks',
				trackIds: JSON.stringify(tracksToRemove)
			},
			{ method: 'post' }
		)
		
		// Close dialog and reset state
		setIsBulkRemoveDialogOpen(false)
		setTracksToRemove([])
	}

	const handleBulkPlayNextSelection = (playlistTrackIds: string[]) => {
		const selectedTracks = optimisticTracks.filter(pt => playlistTrackIds.includes(pt.id))
		const tracks = selectedTracks.map(pt => pt.track as FullTrack)
		const playable = filterPlayableTracks(tracks)

		if (playable.length === 0) {
			console.warn('No playable tracks found in selection')
			return
		}

		applyBulkQueueAction(playable, 'playNext')
		showBulkQueueToast(playable.length, tracks.length - playable.length, 'playNext')
	}

	const handleBulkAddToUpNextSelection = (playlistTrackIds: string[]) => {
		const selectedTracks = optimisticTracks.filter(pt => playlistTrackIds.includes(pt.id))
		const tracks = selectedTracks.map(pt => pt.track as FullTrack)
		const playable = filterPlayableTracks(tracks)

		if (playable.length === 0) {
			console.warn('No playable tracks found in selection')
			return
		}

		applyBulkQueueAction(playable, 'addToUpNext')
		showBulkQueueToast(playable.length, tracks.length - playable.length, 'addToUpNext')
	}

	const handleBulkAddToQueueSelection = (playlistTrackIds: string[]) => {
		const selectedTracks = optimisticTracks.filter(pt => playlistTrackIds.includes(pt.id))
		const tracks = selectedTracks.map(pt => pt.track as FullTrack)
		const playable = filterPlayableTracks(tracks)

		if (playable.length === 0) {
			console.warn('No playable tracks found in selection')
			return
		}

		applyBulkQueueAction(playable, 'addToQueue')
		showBulkQueueToast(playable.length, tracks.length - playable.length, 'addToQueue')
	}

	return (
		<div className="space-y-8">
			{/* Back Button */}
			<div className="flex items-center gap-4">
				<Link 
					to="/playlists"
					className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
				>
					<Icon name="arrow-left" className="h-4 w-4" />
					Back to Playlists
				</Link>
			</div>

			{/* Hero Section */}
			<div className="space-y-4">
				<PlaylistHero
					id={optimisticPlaylist.id}
					title={optimisticPlaylist.title}
					description={optimisticPlaylist.description}
					tracks={optimisticTracks.map(pt => pt.track)}
					createdAt={optimisticPlaylist.createdAt.toISOString()}
					updatedAt={optimisticPlaylist.updatedAt.toISOString()}
					onTitleUpdate={handleTitleUpdate}
					onDescriptionUpdate={handleDescriptionUpdate}
					onBulkPlayNext={handleBulkPlayNext}
					onBulkAddToUpNext={handleBulkAddToUpNext}
					onBulkAddToQueue={handleBulkAddToQueue}
					onDelete={handleDelete}
					isUpdating={updateFetcher.state === 'submitting'}
				/>
				<OfflinePlaylistDownloadButton
					playlistId={optimisticPlaylist.id}
					title={optimisticPlaylist.title}
					description={optimisticPlaylist.description}
					tracks={optimisticTracks.map((playlistTrack) => playlistTrack.track)}
				/>
			</div>

			{/* Tracks Section */}
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl font-bold">Tracks</h2>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Icon name="file-text" className="h-4 w-4" />
						<span>{optimisticTracks.length} track{optimisticTracks.length !== 1 ? 's' : ''}</span>
						{(reorderFetcher.state === 'submitting' || removeTrackFetcher.state === 'submitting') && (
							<Icon name="update" className="h-3 w-3 animate-spin text-primary" />
						)}
					</div>
				</div>
				
				{optimisticTracks.length === 0 ? (
					<div className="text-center py-16 text-muted-foreground">
						<Icon name="file-text" className="h-16 w-16 mx-auto mb-4" />
						<h3 className="text-lg font-semibold mb-2">No tracks yet</h3>
						<p className="mb-6">Start building your playlist by adding tracks from your library.</p>
						<Link 
							to="/library"
							className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
						>
							<Icon name="plus" className="h-5 w-5" />
							Add Tracks from Library
						</Link>
					</div>
				) : (
					<SortableTrackList
						tracks={optimisticTracks.map(pt => ({
							...pt,
							track: {
								...pt.track,
								createdAt: pt.track.createdAt.toISOString()
							}
						}))}
						playlists={playlists}
						onReorder={handleReorder}
						onRemoveTrack={handleRemoveTrack}
						onBulkRemove={handleBulkRemove}
						onBulkPlayNext={handleBulkPlayNextSelection}
						onBulkAddToUpNext={handleBulkAddToUpNextSelection}
						onBulkAddToQueue={handleBulkAddToQueueSelection}
						isReordering={reorderFetcher.state === 'submitting'}
						isRemoving={removeTrackFetcher.state === 'submitting'}
						playlistId={params.playlistId!}
					/>
				)}
			</div>


			{/* Bulk queue confirmation dialog */}
			<AlertDialog
				open={bulkQueueDialogAction !== null}
				onOpenChange={(open) => {
					if (!open) setBulkQueueDialogAction(null)
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{bulkQueueDialogAction
								? bulkQueueActionLabels[bulkQueueDialogAction]
								: 'Queue playlist'}
						</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to {bulkQueueDialogAction
								? bulkQueueActionLabels[bulkQueueDialogAction].toLowerCase()
								: 'queue'} all playable tracks from "{optimisticPlaylist.title}"?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={confirmBulkQueueAction}>
							{bulkQueueDialogAction
								? bulkQueueActionLabels[bulkQueueDialogAction]
								: 'Confirm'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Playlist</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete "{optimisticPlaylist.title}"? This action cannot be undone and will remove all tracks from this playlist.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={confirmDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete Playlist
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Bulk Remove Confirmation Dialog */}
			<AlertDialog open={isBulkRemoveDialogOpen} onOpenChange={setIsBulkRemoveDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove Tracks</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove {tracksToRemove.length} track{tracksToRemove.length !== 1 ? 's' : ''} from "{optimisticPlaylist.title}"? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={confirmBulkRemove}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Remove Tracks
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
		</AlertDialog>
	</div>
	)
}
