import { data } from 'react-router'
import { addTracksToUserLibrary } from '#app/features/user-library/user-library.server'
import { getServiceByName } from '#app/features/service-playlist/playlist-utils.server'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { proxyClientActionToServer } from '#app/utils/server-proxy-client-action.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { type Route } from './+types/add-all-service-tracks-to-library'

/**
 * POST /resources/add-all-service-tracks-to-library
 *
 * Adds all active tracks from all synced service playlists to the user's library.
 * Skips tracks already in the library (silently).
 */
export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)

	try {
		const service = await getServiceByName('youtube')

		// Get all active synced playlists
		const syncedPlaylists = await prisma.servicePlaylist.findMany({
			where: {
				serviceId: service.id,
				ownerId: userId,
				isActive: true,
			},
			select: { id: true },
		})

		if (syncedPlaylists.length === 0) {
			return data(
				{ status: 'error', message: 'No synced playlists found' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'No Playlists',
						description: 'You have no synced playlists to add tracks from.',
						type: 'error',
					}),
				},
			)
		}

		const playlistIds = syncedPlaylists.map((p) => p.id)

		// Get all active (non-deleted) track IDs from all synced playlists
		const playlistTracks = await prisma.servicePlaylistTrack.findMany({
			where: {
				playlistId: { in: playlistIds },
				isDeleted: false,
			},
			select: { trackId: true },
		})

		const allTrackIds = [...new Set(playlistTracks.map((pt) => pt.trackId))]

		if (allTrackIds.length === 0) {
			return data(
				{ status: 'success', message: 'No tracks to add', addedCount: 0 },
				{
					headers: await createToastHeaders({
						title: 'Done',
						description: 'No tracks found across your synced playlists.',
						type: 'success',
					}),
				},
			)
		}

		// Check which are already in library
		const existingLibrary = await prisma.userTrack.findMany({
			where: {
				userId,
				trackId: { in: allTrackIds },
				isActive: true,
			},
			select: { trackId: true },
		})

		const existingTrackIds = new Set(existingLibrary.map((ut) => ut.trackId))
		const missingTrackIds = allTrackIds.filter((id) => !existingTrackIds.has(id))

		if (missingTrackIds.length === 0) {
			return data(
				{
					status: 'success',
					message: 'All tracks are already in your library',
					addedCount: 0,
				},
				{
					headers: await createToastHeaders({
						title: 'Already in Library',
						description: `All ${allTrackIds.length} tracks are already in your library.`,
						type: 'message',
					}),
				},
			)
		}

		const result = await addTracksToUserLibrary(missingTrackIds, userId)

		if (!result.success) {
			return data(
				{ status: 'error', message: result.message },
				{
					status: 500,
					headers: await createToastHeaders({
						title: 'Error',
						description: result.message,
						type: 'error',
					}),
				},
			)
		}

		return data(
			{
				status: 'success',
				message: result.message,
				addedCount: result.addedCount,
				totalTracks: allTrackIds.length,
			},
			{
				headers: await createToastHeaders({
					title: 'Added to Library',
					description: `${result.addedCount} tracks added across ${syncedPlaylists.length} playlists.`,
					type: 'success',
				}),
			},
		)
	} catch (error) {
		console.error('Error adding all service tracks to library:', error)
		return data(
			{ status: 'error', message: 'Internal server error' },
			{
				status: 500,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Failed to add tracks to library. Please try again.',
					type: 'error',
				}),
			},
		)
	}
}

export async function clientAction(args: Route.ClientActionArgs) {
	return proxyClientActionToServer(args)
}
