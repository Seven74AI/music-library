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
        data: { isActive: true, deletedAt: null, createdAt: new Date() },
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
    // trackId -> soft-deleted UserTrack id, so reactivation can get a fresh
    // createdAt stamped by playlist position (updateMany can't set per-row stamps).
    const reactivateByTrackId = new Map(
      existing
        .filter((userTrack) => !userTrack.isActive)
        .map((userTrack) => [userTrack.trackId, userTrack.id]),
    );
    const toCreate = uniqueTrackIds.filter((trackId) => !existingByTrackId.has(trackId));

    // Library lists/plays by UserTrack.createdAt desc. Stagger stamps so the
    // first id in `trackIds` (YouTube playlist order) sorts first, not reverse.
    // Reactivated (soft-deleted) tracks must be re-stamped too, or a re-added
    // track keeps its original old createdAt and sorts out of playlist order.
    const bulkAddedAtMs = Date.now();

    await prisma.$transaction(async (tx) => {
      let position = 0;
      const createRows: Array<{ userId: string; trackId: string; createdAt: Date }> = [];
      for (const trackId of uniqueTrackIds) {
        const createdAt = new Date(bulkAddedAtMs - position);
        position += 1;

        const reactivateId = reactivateByTrackId.get(trackId);
        if (reactivateId !== undefined) {
          await tx.userTrack.update({
            where: { id: reactivateId },
            data: { isActive: true, deletedAt: null, createdAt },
          });
        } else if (!existingByTrackId.has(trackId)) {
          createRows.push({ userId, trackId, createdAt });
        }
      }

      for (const chunk of chunkArray(createRows)) {
        await tx.userTrack.createMany({ data: chunk });
      }
    });

    const addedCount = reactivateByTrackId.size + toCreate.length;
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
