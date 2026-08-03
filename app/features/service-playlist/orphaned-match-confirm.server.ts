import { getOrCreateArtistTx } from "#app/utils/artist-management.server";
import { prisma } from "#app/utils/db.server";
import { getServiceByName } from "./playlist-utils.server";

export type OrphanMatchSelection = {
  deletedItemId: string | undefined;
  selectedTrackId: string | null;
  position: number;
  action: "match" | "new" | "skip";
};

/**
 * Track ids selected more than once across match actions.
 */
export function getDuplicateMatchedTrackIds(
  matches: Array<{ action: string; selectedTrackId?: string | null }>,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const match of matches) {
    if (match.action !== "match" || !match.selectedTrackId) continue;
    if (seen.has(match.selectedTrackId)) {
      duplicates.add(match.selectedTrackId);
    } else {
      seen.add(match.selectedTrackId);
    }
  }

  return [...duplicates];
}

/**
 * Confirm deleted video matches — process user selections for pending matches.
 *
 * Handles creating new tracks for deleted videos, matching to existing orphan tracks,
 * or skipping.
 */
export async function confirmOrphanedMatches(
  playlistId: string,
  matches: OrphanMatchSelection[],
  userId: string,
): Promise<{
  success: boolean;
  processedCount: number;
  message: string;
  error?: string;
}> {
  const playlist = await prisma.servicePlaylist.findFirst({
    where: {
      id: playlistId,
      ownerId: userId,
      isActive: true,
    },
    include: { service: true },
  });

  if (!playlist) {
    return {
      success: false,
      processedCount: 0,
      message: "Playlist not found or access denied",
      error: "Playlist not found or access denied",
    };
  }

  if (!playlist.service) {
    return {
      success: false,
      processedCount: 0,
      message: "Service not found for playlist",
      error: "Service not found for playlist",
    };
  }

  const duplicateTrackIds = getDuplicateMatchedTrackIds(matches);
  if (duplicateTrackIds.length > 0) {
    return {
      success: false,
      processedCount: 0,
      message: "Each orphaned track can only be matched to one deleted video.",
      error: `Duplicate track selections: ${duplicateTrackIds.join(", ")}`,
    };
  }

  const service = await getServiceByName(playlist.service.name);
  const { createId } = await import("@paralleldrive/cuid2");

  try {
    const result = await prisma.$transaction(async (tx) => {
      let processedCount = 0;

      for (const match of matches) {
        if (match.action === "skip") {
          continue;
        }

        if (match.action === "new") {
          const newTrackId = createId();
          const externalId = match.deletedItemId || `deleted-${playlistId}-${match.position}`;

          const artistRecord = await getOrCreateArtistTx(tx, "Unknown Artist");

          const track = await tx.track.create({
            data: {
              id: newTrackId,
              title: "Deleted video",
              artistId: artistRecord.id,
              duration: null,
              externalId,
              serviceId: service.id,
              serviceUrl: null,
              releaseDate: null,
            },
          });

          await tx.servicePlaylistTrack.create({
            data: {
              id: createId(),
              playlistId,
              trackId: track.id,
              position: match.position,
              isDeleted: true,
              deletedAt: new Date(),
            },
          });

          processedCount++;
        } else if (match.action === "match" && match.selectedTrackId) {
          const track = await tx.track.findUnique({
            where: { id: match.selectedTrackId },
          });

          if (!track) {
            throw new Error(`Track not found: ${match.selectedTrackId}`);
          }

          const existingPlaylistTrack = await tx.servicePlaylistTrack.findUnique({
            where: {
              playlistId_trackId: {
                playlistId,
                trackId: track.id,
              },
            },
          });

          if (existingPlaylistTrack) {
            await tx.servicePlaylistTrack.update({
              where: {
                playlistId_trackId: {
                  playlistId,
                  trackId: track.id,
                },
              },
              data: {
                position: match.position,
                isDeleted: true,
                deletedAt: existingPlaylistTrack.deletedAt || new Date(),
              },
            });
          } else {
            await tx.servicePlaylistTrack.create({
              data: {
                id: createId(),
                playlistId,
                trackId: track.id,
                position: match.position,
                isDeleted: true,
                deletedAt: new Date(),
              },
            });
          }

          processedCount++;
        }
      }

      return { processedCount };
    });

    return {
      success: true,
      processedCount: result.processedCount,
      message: `Successfully processed ${result.processedCount} match(es).`,
    };
  } catch (error) {
    console.error("Error confirming deleted video matches:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return {
      success: false,
      processedCount: 0,
      message: `Failed to process matches. No changes were made. Please try again.`,
      error: errorMessage,
    };
  }
}
