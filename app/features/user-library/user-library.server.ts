import {
  recordUsageEvent,
  USAGE_EVENT_TYPES,
} from "#app/features/usage-analytics/record-usage.server.ts";
import { chunkArray } from "#app/utils/chunk-array";
import { prisma } from "#app/utils/db.server";

export async function addTrackToUserLibrary(
  trackId: string,
  userId: string,
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const existing = await prisma.userTrack.findUnique({
      where: {
        userId_trackId: { userId, trackId },
      },
    });

    if (existing) {
      if (existing.isActive) {
        return { success: true, message: "Track already in library" };
      }
      await prisma.userTrack.update({
        where: { id: existing.id },
        data: { isActive: true, deletedAt: null },
      });
      void recordUsageEvent({
        type: USAGE_EVENT_TYPES.library_add,
        userId,
        trackId,
      }).catch(() => {});
      return { success: true, message: "Track re-added to library" };
    }

    await prisma.userTrack.create({
      data: { userId, trackId },
    });
    void recordUsageEvent({
      type: USAGE_EVENT_TYPES.library_add,
      userId,
      trackId,
    }).catch(() => {});
    return { success: true, message: "Track added to library" };
  } catch (error) {
    console.error("Error adding track to user library:", error);
    return {
      success: false,
      message: "Failed to add track to library",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function addTracksToUserLibrary(
  trackIds: string[],
  userId: string,
): Promise<{
  success: boolean;
  message: string;
  addedCount: number;
  error?: string;
}> {
  const uniqueTrackIds = [
    ...new Set(
      trackIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  ];

  if (uniqueTrackIds.length === 0) {
    return {
      success: true,
      message: "No tracks to add",
      addedCount: 0,
    };
  }

  try {
    const existing = [];
    for (const trackIdChunk of chunkArray(uniqueTrackIds)) {
      const batch = await prisma.userTrack.findMany({
        where: {
          userId,
          trackId: { in: trackIdChunk },
        },
      });
      existing.push(...batch);
    }

    const existingByTrackId = new Map(existing.map((userTrack) => [userTrack.trackId, userTrack]));
    const toReactivate = existing
      .filter((userTrack) => !userTrack.isActive)
      .map((userTrack) => userTrack.id);
    const toCreate = uniqueTrackIds.filter((trackId) => !existingByTrackId.has(trackId));

    // Library lists/plays by UserTrack.createdAt desc. Stagger stamps so the
    // first id in `trackIds` (YouTube playlist order) sorts first, not reverse.
    const bulkAddedAtMs = Date.now();

    await prisma.$transaction(async (tx) => {
      for (const idChunk of chunkArray(toReactivate)) {
        await tx.userTrack.updateMany({
          where: { id: { in: idChunk } },
          data: { isActive: true, deletedAt: null },
        });
      }
      let createIndex = 0;
      for (const trackIdChunk of chunkArray(toCreate)) {
        await tx.userTrack.createMany({
          data: trackIdChunk.map((trackId) => ({
            userId,
            trackId,
            createdAt: new Date(bulkAddedAtMs - createIndex++),
          })),
        });
      }
    });

    const addedCount = toReactivate.length + toCreate.length;
    if (addedCount > 0) {
      void recordUsageEvent({
        type: USAGE_EVENT_TYPES.library_add,
        userId,
        meta: { count: addedCount },
        amount: addedCount,
      }).catch(() => {});
    }
    return {
      success: true,
      message: `${addedCount} track${addedCount !== 1 ? "s" : ""} added to library`,
      addedCount,
    };
  } catch (error) {
    console.error("Error adding tracks to user library:", error);
    return {
      success: false,
      message: "Failed to add tracks to library",
      addedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function removeTrackFromUserLibrary(
  trackId: string,
  userId: string,
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const existing = await prisma.userTrack.findUnique({
      where: {
        userId_trackId: { userId, trackId },
      },
    });

    if (!existing || !existing.isActive) {
      return { success: false, message: "Track not found in library" };
    }

    await prisma.userTrack.update({
      where: { id: existing.id },
      data: { isActive: false, deletedAt: new Date() },
    });
    return { success: true, message: "Track removed from library" };
  } catch (error) {
    console.error("Error removing track from user library:", error);
    return {
      success: false,
      message: "Failed to remove track from library",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function removeTracksFromUserLibrary(
  trackIds: string[],
  userId: string,
): Promise<{ success: boolean; message: string; removedCount: number; error?: string }> {
  const uniqueTrackIds = [
    ...new Set(
      trackIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  ];

  if (uniqueTrackIds.length === 0) {
    return { success: true, message: "No tracks to remove", removedCount: 0 };
  }

  try {
    // Soft-delete every active membership in one pass, chunked to stay under
    // SQLite's bind limit.
    let removedCount = 0;
    for (const idChunk of chunkArray(uniqueTrackIds)) {
      const result = await prisma.userTrack.updateMany({
        where: { userId, trackId: { in: idChunk }, isActive: true },
        data: { isActive: false, deletedAt: new Date() },
      });
      removedCount += result.count;
    }

    return {
      success: true,
      message: `${removedCount} track${removedCount !== 1 ? "s" : ""} removed from library`,
      removedCount,
    };
  } catch (error) {
    console.error("Error removing tracks from user library:", error);
    return {
      success: false,
      message: "Failed to remove tracks from library",
      removedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
