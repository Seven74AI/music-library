import { chunkArray } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server";

export class ServiceConfigurationError extends Error {
  constructor(serviceName: string) {
    super(`Service not configured: ${serviceName}`);
    this.name = "ServiceConfigurationError";
  }
}

export async function getServiceByName(serviceName: string) {
  const service = await prisma.service.findUnique({
    where: { name: serviceName },
  });

  if (!service) {
    throw new ServiceConfigurationError(serviceName);
  }

  return service;
}

/**
 * Returns all unique, active (non-deleted) track IDs across all synced
 * playlists for a service. Also returns the synced playlist IDs for reuse.
 */
export async function getActiveSyncedPlaylistTrackIds(
  userId: string,
  serviceName: string = "youtube",
): Promise<{ playlistIds: string[]; trackIds: string[] }> {
  const service = await getServiceByName(serviceName);

  const syncedPlaylists = await prisma.servicePlaylist.findMany({
    where: { serviceId: service.id, ownerId: userId, isActive: true },
    select: { id: true },
  });

  if (syncedPlaylists.length === 0) {
    return { playlistIds: [], trackIds: [] };
  }

  const playlistIds = syncedPlaylists.map((p) => p.id);

  const playlistTracks: { trackId: string }[] = [];
  for (const playlistIdChunk of chunkArray(playlistIds)) {
    const batch = await prisma.servicePlaylistTrack.findMany({
      where: { playlistId: { in: playlistIdChunk }, isDeleted: false },
      select: { trackId: true },
    });
    playlistTracks.push(...batch);
  }

  const trackIds = [...new Set(playlistTracks.map((pt) => pt.trackId))];

  return { playlistIds, trackIds };
}

/**
 * Computes total active track count and how many are missing from the user's
 * library across all synced playlists for a service.
 *
 * Used by both the synced-playlists page loader (for the "Add All Missing"
 * button badge) and the add-all-service-tracks-to-library route action.
 */
export async function getSyncedPlaylistsTrackStats(
  userId: string,
  serviceName: string = "youtube",
): Promise<{ totalTracks: number; missingTracks: number }> {
  const { trackIds } = await getActiveSyncedPlaylistTrackIds(userId, serviceName);
  const totalTracks = trackIds.length;

  if (totalTracks === 0) {
    return { totalTracks: 0, missingTracks: 0 };
  }

  const libraryRows: { trackId: string }[] = [];
  for (const trackIdChunk of chunkArray(trackIds)) {
    const batch = await prisma.userTrack.findMany({
      where: {
        userId,
        trackId: { in: trackIdChunk },
        isActive: true,
        deletedAt: null,
      },
      select: { trackId: true },
    });
    libraryRows.push(...batch);
  }

  const librarySet = new Set(libraryRows.map((ut) => ut.trackId));
  const missingTracks = trackIds.filter((id) => !librarySet.has(id)).length;

  return { totalTracks, missingTracks };
}
