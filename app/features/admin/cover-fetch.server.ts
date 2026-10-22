import { processTrackImagesAsync } from "#app/features/service-playlist/image-processor.server";
import { downloadExternalImage, findOrCreateCoverImage } from "#app/utils/cover-management.server";
import { prisma } from "#app/utils/db.server";
import { type Prisma } from "#prisma/client.js";

export async function getTracksWithoutCovers(params: { limit?: number; offset?: number } = {}) {
  const { limit = 50, offset = 0 } = params;

  const tracks = await prisma.track.findMany({
    where: {
      coverImageId: null,
    },
    include: {
      artist: { select: { id: true, name: true } },
      service: { select: { id: true, name: true, displayName: true } },
      albumRecord: { select: { id: true, name: true } },
      servicePlaylistTracks: {
        where: { thumbnailUrl: { not: null } },
        select: { thumbnailUrl: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  return tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artistName: track.artist.name,
    artistId: track.artist.id,
    albumName: track.albumRecord?.name ?? null,
    albumId: track.albumRecord?.id ?? null,
    serviceName: track.service.displayName || track.service.name,
    serviceId: track.service.id,
    createdAt: track.createdAt.toISOString(),
    thumbnailUrl: track.servicePlaylistTracks[0]?.thumbnailUrl ?? null,
  }));
}

export async function countTracksWithoutCovers(): Promise<number> {
  return prisma.track.count({
    where: {
      coverImageId: null,
    },
  });
}

export async function getAlbumsWithoutCovers(params: { limit?: number; offset?: number } = {}) {
  const { limit = 50, offset = 0 } = params;

  const albums = await prisma.album.findMany({
    where: {
      coverImageId: null,
    },
    include: {
      artist: { select: { id: true, name: true } },
      tracks: {
        select: {
          id: true,
          title: true,
          coverImageId: true,
          coverImage: {
            select: {
              id: true,
              objectKey: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  return albums.map((album) => ({
    id: album.id,
    name: album.name,
    artistName: album.artist.name,
    artistId: album.artist.id,
    trackCount: album.tracks.length,
    tracksWithCovers: album.tracks.filter((t) => t.coverImageId !== null),
    createdAt: album.createdAt.toISOString(),
  }));
}

export async function countAlbumsWithoutCovers(): Promise<number> {
  return prisma.album.count({
    where: {
      coverImageId: null,
    },
  });
}

export async function getCoverStatistics() {
  const totalTracks = await prisma.track.count();
  const tracksWithCovers = await prisma.track.count({
    where: { coverImageId: { not: null } },
  });

  const services = await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true, displayName: true },
  });

  const serviceStats = await Promise.all(
    services.map(async (service) => {
      const total = await prisma.track.count({
        where: { serviceId: service.id },
      });
      const withCovers = await prisma.track.count({
        where: {
          serviceId: service.id,
          coverImageId: { not: null },
        },
      });
      return {
        serviceId: service.id,
        serviceName: service.displayName || service.name,
        totalTracks: total,
        tracksWithCovers: withCovers,
        coveragePercentage: total > 0 ? Math.round((withCovers / total) * 100 * 100) / 100 : 0,
      };
    }),
  );

  return {
    totalTracks,
    tracksWithCovers,
    coveragePercentage:
      totalTracks > 0 ? Math.round((tracksWithCovers / totalTracks) * 100 * 100) / 100 : 0,
    serviceStats: serviceStats.filter((s) => s.totalTracks > 0),
  };
}

export async function retryAllFailedFetches(): Promise<{ queued: number }> {
  const { processTrackImagesAsync } =
    await import("#app/features/service-playlist/image-processor.server");

  const tracks = await prisma.track.findMany({
    where: {
      coverImageId: null,
      servicePlaylistTracks: {
        some: {
          thumbnailUrl: { not: null },
        },
      },
    },
    select: {
      servicePlaylistTracks: {
        where: { thumbnailUrl: { not: null } },
        select: { playlistId: true },
        take: 1,
      },
    },
  });

  const playlistIds = new Set<string>();
  for (const track of tracks) {
    const playlistId = track.servicePlaylistTracks[0]?.playlistId;
    if (playlistId) {
      playlistIds.add(playlistId);
    }
  }

  for (const playlistId of playlistIds) {
    void processTrackImagesAsync(playlistId).catch((error: unknown) => {
      console.error(`Error processing images for playlist ${playlistId}:`, error);
    });
  }

  return { queued: tracks.length };
}

export async function retryFetchCover(
  trackId: string,
): Promise<{ success: boolean; error?: string }> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: {
      service: { select: { id: true, name: true } },
      servicePlaylistTracks: {
        where: { thumbnailUrl: { not: null } },
        select: { thumbnailUrl: true },
        take: 1,
      },
    },
  });

  if (!track) {
    return { success: false, error: "Track not found" };
  }

  if (track.coverImageId) {
    return { success: false, error: "Track already has cover" };
  }

  const thumbnailUrl = track.servicePlaylistTracks[0]?.thumbnailUrl;
  if (!thumbnailUrl) {
    return { success: false, error: "No thumbnail URL available" };
  }

  try {
    const imageBuffer = await downloadExternalImage(thumbnailUrl);
    if (!imageBuffer) {
      return { success: false, error: "Failed to download image" };
    }

    const coverImage = await findOrCreateCoverImage({
      imageBuffer,
      trackId: track.id,
    });

    await prisma.track.update({
      where: { id: track.id },
      data: { coverImageId: coverImage.id },
    });

    if (track.albumId) {
      const album = await prisma.album.findUnique({
        where: { id: track.albumId },
        select: { coverImageId: true },
      });

      if (album && !album.coverImageId) {
        await prisma.album.update({
          where: { id: track.albumId },
          data: { coverImageId: coverImage.id },
        });
      }
    }

    return { success: true };
  } catch (error) {
    console.error(`Error fetching cover for track ${trackId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function uploadTrackCover(
  trackId: string,
  imageBuffer: Buffer,
): Promise<{ success: boolean; error?: string }> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, albumId: true },
  });

  if (!track) {
    return { success: false, error: "Track not found" };
  }

  try {
    // Do not pass albumId. findOrCreateCoverImage reuses an album's current
    // cover and would drop the file chosen on this upload.
    const coverImage = await findOrCreateCoverImage({
      imageBuffer,
      trackId: track.id,
    });

    await prisma.track.update({
      where: { id: track.id },
      data: { coverImageId: coverImage.id },
    });

    if (track.albumId) {
      const album = await prisma.album.findUnique({
        where: { id: track.albumId },
        select: { coverImageId: true },
      });

      if (album && !album.coverImageId) {
        await prisma.album.update({
          where: { id: track.albumId },
          data: { coverImageId: coverImage.id },
        });
      }
    }

    return { success: true };
  } catch (error) {
    console.error(`Error uploading cover for track ${trackId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function uploadAlbumCover(
  albumId: string,
  imageBuffer: Buffer,
): Promise<{ success: boolean; error?: string }> {
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: { id: true },
  });

  if (!album) {
    return { success: false, error: "Album not found" };
  }

  try {
    const coverImage = await findOrCreateCoverImage({
      imageBuffer,
      albumId: album.id,
    });

    await prisma.album.update({
      where: { id: album.id },
      data: { coverImageId: coverImage.id },
    });

    return { success: true };
  } catch (error) {
    console.error(`Error uploading cover for album ${albumId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function inheritCoverFromTrack(
  albumId: string,
  trackId: string,
): Promise<{ success: boolean; error?: string }> {
  const [album, track] = await Promise.all([
    prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true },
    }),
    prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, coverImageId: true, albumId: true },
    }),
  ]);

  if (!album) {
    return { success: false, error: "Album not found" };
  }

  if (!track) {
    return { success: false, error: "Track not found" };
  }

  if (track.albumId !== albumId) {
    return { success: false, error: "Track does not belong to this album" };
  }

  if (!track.coverImageId) {
    return { success: false, error: "Track does not have a cover" };
  }

  try {
    await prisma.album.update({
      where: { id: albumId },
      data: { coverImageId: track.coverImageId },
    });

    return { success: true };
  } catch (error) {
    console.error(`Error inheriting cover for album ${albumId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function smartAlbumInheritance(trackId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;

  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      coverImageId: true,
      albumId: true,
    },
  });

  if (!track || !track.coverImageId || !track.albumId) {
    return;
  }

  const album = await db.album.findUnique({
    where: { id: track.albumId },
    select: { coverImageId: true },
  });

  if (album && !album.coverImageId) {
    await db.album.update({
      where: { id: track.albumId },
      data: { coverImageId: track.coverImageId },
    });
  }
}
