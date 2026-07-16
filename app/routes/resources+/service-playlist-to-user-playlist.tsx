import { data } from 'react-router'
import { chunkArray } from '#app/utils/chunk-array'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { proxyClientActionToServer } from '#app/utils/server-proxy-client-action.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import {
	userPlaylistTitleTaken,
} from '#app/utils/user-playlist.server.ts'
import { type Route } from './+types/service-playlist-to-user-playlist'

/**
 * POST /resources/service-playlist-to-user-playlist
 *
 * Converts a service playlist's tracks into a user playlist.
 *
 * Body params:
 *   - playlistId: the service playlist ID
 *   - action: "create" | "add"
 *   - title: (for "create") the new playlist title
 *   - targetPlaylistId: (for "add") the target user playlist ID
 *
 * Deleted tracks (isDeleted: true) are excluded.
 * For "add", duplicates are silently skipped.
 */
export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()

	const playlistId = formData.get('playlistId')
	const actionType = formData.get('action')

	if (typeof playlistId !== 'string' || !playlistId) {
		return data(
			{ status: 'error', message: 'Invalid playlist ID' },
			{
				status: 400,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Invalid playlist ID',
					type: 'error',
				}),
			},
		)
	}

	// Verify the user owns this service playlist
	const servicePlaylist = await prisma.servicePlaylist.findFirst({
		where: { id: playlistId, ownerId: userId, isActive: true },
		select: { id: true, title: true },
	})

	if (!servicePlaylist) {
		return data(
			{ status: 'error', message: 'Playlist not found or access denied' },
			{
				status: 404,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Playlist not found or access denied',
					type: 'error',
				}),
			},
		)
	}

	// Get all active track IDs from this service playlist
	const playlistTracks = await prisma.servicePlaylistTrack.findMany({
		where: { playlistId, isDeleted: false },
		select: { trackId: true },
		orderBy: { position: 'asc' },
	})

	const trackIds = playlistTracks.map((pt) => pt.trackId)

	if (trackIds.length === 0) {
		return data(
			{ status: 'success', message: 'No tracks in playlist', addedCount: 0, skippedCount: 0 },
			{
				headers: await createToastHeaders({
					title: 'No Tracks',
					description: `"${servicePlaylist.title}" has no tracks to add.`,
					type: 'message',
				}),
			},
		)
	}

	try {
		if (actionType === 'create') {
			const title = formData.get('title')
			if (typeof title !== 'string' || !title.trim()) {
				return data(
					{ status: 'error', message: 'Playlist name is required' },
					{
						status: 400,
						headers: await createToastHeaders({
							title: 'Error',
							description: 'Playlist name is required',
							type: 'error',
						}),
					},
				)
			}

			const trimmedTitle = title.trim()
			const duplicate = await userPlaylistTitleTaken({ userId, title: trimmedTitle })
			if (duplicate.taken) {
				return data(
					{
						status: 'duplicate_title',
						message: `You already have a playlist named "${duplicate.existingTitle ?? trimmedTitle}"`,
						existingTitle: duplicate.existingTitle ?? trimmedTitle,
					},
					{
						status: 409,
						headers: await createToastHeaders({
							title: 'Duplicate Playlist',
							description: `You already have a playlist named "${duplicate.existingTitle ?? trimmedTitle}"`,
							type: 'error',
						}),
					},
				)
			}

			// Create playlist and bulk-add all tracks in a transaction
			const userPlaylist = await prisma.$transaction(async (tx) => {
				const playlist = await tx.userPlaylist.create({
					data: { title: trimmedTitle, ownerId: userId },
					select: { id: true, title: true },
				})

				let position = 0
				for (const chunk of chunkArray(trackIds)) {
					await tx.userPlaylistTrack.createMany({
						data: chunk.map((trackId) => ({
							playlistId: playlist.id,
							trackId,
							position: position++,
						})),
					})
				}

				return playlist
			})

			return data(
				{
					status: 'success',
					message: `Created "${userPlaylist.title}" with ${trackIds.length} tracks`,
					addedCount: trackIds.length,
					skippedCount: 0,
					playlist: userPlaylist,
				},
				{
					headers: await createToastHeaders({
						title: 'Playlist Created',
						description: `"${userPlaylist.title}" created with ${trackIds.length} tracks.`,
						type: 'success',
					}),
				},
			)
		}

		if (actionType === 'add') {
			const targetPlaylistId = formData.get('targetPlaylistId')
			if (typeof targetPlaylistId !== 'string' || !targetPlaylistId) {
				return data(
					{ status: 'error', message: 'Invalid target playlist ID' },
					{
						status: 400,
						headers: await createToastHeaders({
							title: 'Error',
							description: 'Target playlist not specified',
							type: 'error',
						}),
					},
				)
			}

			// Verify ownership of target playlist
			const targetPlaylist = await prisma.userPlaylist.findFirst({
				where: { id: targetPlaylistId, ownerId: userId },
				select: { id: true, title: true },
			})

			if (!targetPlaylist) {
				return data(
					{ status: 'error', message: 'Target playlist not found' },
					{
						status: 404,
						headers: await createToastHeaders({
							title: 'Error',
							description: 'Target playlist not found or access denied',
							type: 'error',
						}),
					},
				)
			}

			// Check which tracks already exist in the target playlist
			const existingTracks = await prisma.userPlaylistTrack.findMany({
				where: {
					playlistId: targetPlaylistId,
					trackId: { in: trackIds },
				},
				select: { trackId: true },
			})

			const existingSet = new Set(existingTracks.map((et) => et.trackId))
			const newTrackIds = trackIds.filter((id) => !existingSet.has(id))
			const skippedCount = trackIds.length - newTrackIds.length

			if (newTrackIds.length === 0) {
				return data(
					{
						status: 'success',
						message: `All ${trackIds.length} tracks already in "${targetPlaylist.title}"`,
						addedCount: 0,
						skippedCount,
					},
					{
						headers: await createToastHeaders({
							title: 'Already in Playlist',
							description: `All ${trackIds.length} tracks are already in "${targetPlaylist.title}".`,
							type: 'message',
						}),
					},
				)
			}

			// Get the max position for appending
			const maxPosition = await prisma.userPlaylistTrack.aggregate({
				where: { playlistId: targetPlaylistId },
				_max: { position: true },
			})

			let nextPosition = (maxPosition._max.position ?? -1) + 1

			// Bulk insert new tracks
			for (const chunk of chunkArray(newTrackIds)) {
				await prisma.userPlaylistTrack.createMany({
					data: chunk.map((trackId) => ({
						playlistId: targetPlaylistId,
						trackId,
						position: nextPosition++,
					})),
				})
			}

			return data(
				{
					status: 'success',
					message: `${newTrackIds.length} tracks added, ${skippedCount} already present`,
					addedCount: newTrackIds.length,
					skippedCount,
				},
				{
					headers: await createToastHeaders({
						title: 'Tracks Added',
						description: `${newTrackIds.length} added to "${targetPlaylist.title}"${skippedCount > 0 ? ` (${skippedCount} already present)` : ''}.`,
						type: 'success',
					}),
				},
			)
		}

		return data(
			{ status: 'error', message: 'Invalid action. Must be "create" or "add".' },
			{
				status: 400,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Invalid action type',
					type: 'error',
				}),
			},
		)
	} catch (error) {
		console.error('Error converting service playlist to user playlist:', error)
		return data(
			{ status: 'error', message: 'Internal server error' },
			{
				status: 500,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Failed to convert playlist. Please try again.',
					type: 'error',
				}),
			},
		)
	}
}

export async function clientAction(args: Route.ClientActionArgs) {
	return proxyClientActionToServer(args)
}
