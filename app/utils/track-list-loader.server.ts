import { chunkArray } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server.ts";

export async function loadUserPlaylists(userId: string | null) {
  if (!userId) {
    return [];
  }

  return prisma.userPlaylist.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      title: true,
      description: true,
      _count: { select: { tracks: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function loadLibraryStatusByTrackId(userId: string | null, trackIds: string[]) {
  if (!userId || trackIds.length === 0) {
    return {
      libraryTrackIds: new Set<string>(),
      userTrackCreatedAtByTrackId: new Map<string, Date>(),
    };
  }

  const userTracks: Array<{ trackId: string; createdAt: Date }> = [];
  for (const trackIdChunk of chunkArray(trackIds)) {
    const batch = await prisma.userTrack.findMany({
      where: {
        userId,
        isActive: true,
        deletedAt: null,
        trackId: { in: trackIdChunk },
      },
      select: { trackId: true, createdAt: true },
    });
    userTracks.push(...batch);
  }

  return {
    libraryTrackIds: new Set(userTracks.map((userTrack) => userTrack.trackId)),
    userTrackCreatedAtByTrackId: new Map(
      userTracks.map((userTrack) => [userTrack.trackId, userTrack.createdAt]),
    ),
  };
}
