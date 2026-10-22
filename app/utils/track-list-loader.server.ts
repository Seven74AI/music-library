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

  const userTracks = await prisma.userTrack.findMany({
    where: {
      userId,
      isActive: true,
      trackId: { in: trackIds },
    },
    select: { trackId: true, createdAt: true },
  });

  return {
    libraryTrackIds: new Set(userTracks.map((userTrack) => userTrack.trackId)),
    userTrackCreatedAtByTrackId: new Map(
      userTracks.map((userTrack) => [userTrack.trackId, userTrack.createdAt]),
    ),
  };
}
