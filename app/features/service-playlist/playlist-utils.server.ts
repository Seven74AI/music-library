import { prisma } from '#app/utils/db.server'

export class ServiceNotFoundError extends Error {
	constructor(serviceName: string) {
		super(`Service not found: ${serviceName}`)
		this.name = 'ServiceNotFoundError'
	}
}

export async function getServiceByName(serviceName: string) {
	const service = await prisma.service.findUnique({
		where: { name: serviceName },
	})

	if (!service) {
		throw new ServiceNotFoundError(serviceName)
	}

	return service
}

/**
 * Computes total active track count and how many are missing from the user's
 * library across all synced playlists for a service.
 *
 * Used by both the synced-playlists page loader (for the "Add All Missing"
 * button badge) and the add-all-service-tracks-to-library route action.
 */

/**
 * Returns all unique, active (non-deleted) track IDs across all synced
 * playlists for a service. Also returns the synced playlist IDs for reuse.
 */
export async function getActiveSyncedPlaylistTrackIds(
	userId: string,
	serviceName: string = 'youtube',
): Promise<{ playlistIds: string[]; trackIds: string[] }> {
	const service = await getServiceByName(serviceName)

	const syncedPlaylists = await prisma.servicePlaylist.findMany({
		where: { serviceId: service.id, ownerId: userId, isActive: true },
		select: { id: true },
	})

	if (syncedPlaylists.length === 0) {
		return { playlistIds: [], trackIds: [] }
	}

	const playlistIds = syncedPlaylists.map((p) => p.id)

	const playlistTracks = await prisma.servicePlaylistTrack.findMany({
		where: { playlistId: { in: playlistIds }, isDeleted: false },
		select: { trackId: true },
	})

	const trackIds = [...new Set(playlistTracks.map((pt) => pt.trackId))]

	return { playlistIds, trackIds }
}

export async function getSyncedPlaylistsTrackStats(
	userId: string,
	serviceName: string = 'youtube',
): Promise<{ totalTracks: number; missingTracks: number }> {
	const { trackIds } = await getActiveSyncedPlaylistTrackIds(userId, serviceName)
	const totalTracks = trackIds.length

	if (totalTracks === 0) {
		return { totalTracks: 0, missingTracks: 0 }
	}

	const libraryTrackIds = await prisma.userTrack.findMany({
		where: { userId, trackId: { in: trackIds }, isActive: true },
		select: { trackId: true },
	})

	const librarySet = new Set(libraryTrackIds.map((ut) => ut.trackId))
	const missingTracks = trackIds.filter((id) => !librarySet.has(id)).length

	return { totalTracks, missingTracks }
}
