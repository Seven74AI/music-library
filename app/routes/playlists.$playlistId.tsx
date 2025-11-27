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
import { data, redirect, Form, Link, useActionData, useNavigation, useFetcher, useParams } from 'react-router'
import { useAudioPlayer } from '#app/components/audio-player-provider.tsx'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { PlaylistHero } from '#app/components/playlist-hero'
import { SortableTrackList } from '#app/components/sortable-track-list'
import { TrackListItem } from '#app/components/track-list-item'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '#app/components/ui/alert-dialog'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { toast } from '#app/components/ui/use-toast.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getPlaylistTitle } from '#app/utils/breadcrumb-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { type Route } from './+types/playlists.$playlistId.ts'

export const handle: BreadcrumbHandle = {
	breadcrumb: ({ data }) => getPlaylistTitle(data),
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
							artist: true,
							duration: true,
							thumbnailUrl: true,
							serviceUrl: true,
							createdAt: true,
							service: {
								select: {
									displayName: true,
									logoUrl: true,
								}
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

	return data({ playlist, playlists: userPlaylists })
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
		} catch (error) {
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
			const playlistTracks = await prisma.userPlaylistTrack.findMany({
				where: {
					id: { in: trackIdArray },
					playlist: {
						ownerId: userId,
						id: params.playlistId,
					},
				},
			})

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
			await prisma.userPlaylistTrack.deleteMany({
				where: {
					id: { in: trackIdArray },
				},
			})

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
		} catch (error) {
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

export default function PlaylistRoute({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const params = useParams()
	const isSubmitting = navigation.state === 'submitting'
	const { playlist, playlists } = loaderData
	
	// Audio player context (audio playback disabled)
	const { addToCurrentPlaylist } = useAudioPlayer()
	
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
	}, [playlist])

	// Handle success messages from fetchers
	useEffect(() => {
		if (updateFetcher.data && 'success' in updateFetcher.data) {
			console.log('Playlist updated:', updateFetcher.data.message)
		}
		if (reorderFetcher.data && 'success' in reorderFetcher.data) {
			console.log('Tracks reordered:', reorderFetcher.data.message)
		}
		if (removeTrackFetcher.data && 'success' in removeTrackFetcher.data) {
			console.log('Track removed:', removeTrackFetcher.data.message)
		}
	}, [updateFetcher.data, reorderFetcher.data, removeTrackFetcher.data])

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

	const [isAddToQueueDialogOpen, setIsAddToQueueDialogOpen] = useState(false)

	const handleAddAllToQueue = () => {
		setIsAddToQueueDialogOpen(true)
	}

	const confirmAddToQueue = () => {
		// Add all tracks to the current playlist
		const tracks = optimisticTracks.map(pt => pt.track)
		tracks.forEach(track => addToCurrentPlaylist(track))
		
		// Show success toast
		toast({
			title: 'Success',
			description: `${tracks.length} tracks added to queue`,
			variant: 'success',
		})
		
		setIsAddToQueueDialogOpen(false)
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

	const handleBulkAddToQueue = (playlistTrackIds: string[]) => {
		// Find the selected tracks
		const selectedTracks = optimisticTracks.filter(pt => playlistTrackIds.includes(pt.id))
		const tracks = selectedTracks.map(pt => pt.track)
		
		if (tracks.length === 0) {
			console.warn('No tracks found in selection')
			return
		}
		
		// Add each track to the current playlist
		tracks.forEach(track => addToCurrentPlaylist(track))
		
		// Show success toast
		toast({
			title: 'Success',
			description: `${tracks.length} tracks added to queue`,
			variant: 'success',
		})
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
			<PlaylistHero
				id={optimisticPlaylist.id}
				title={optimisticPlaylist.title}
				description={optimisticPlaylist.description}
				tracks={optimisticTracks.map(pt => pt.track)}
				createdAt={optimisticPlaylist.createdAt.toISOString()}
				updatedAt={optimisticPlaylist.updatedAt.toISOString()}
				onTitleUpdate={handleTitleUpdate}
				onDescriptionUpdate={handleDescriptionUpdate}
				onAddAllToQueue={handleAddAllToQueue}
				onDelete={handleDelete}
				isUpdating={updateFetcher.state === 'submitting'}
			/>

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
						onBulkAddToQueue={handleBulkAddToQueue}
						isReordering={reorderFetcher.state === 'submitting'}
						isRemoving={removeTrackFetcher.state === 'submitting'}
						playlistId={params.playlistId!}
					/>
				)}
			</div>


			{/* Add to Queue Confirmation Dialog */}
			<AlertDialog open={isAddToQueueDialogOpen} onOpenChange={setIsAddToQueueDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Add to Queue</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to add all playable tracks from "{optimisticPlaylist.title}" to the current queue?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={confirmAddToQueue}>
							Add to Queue
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
