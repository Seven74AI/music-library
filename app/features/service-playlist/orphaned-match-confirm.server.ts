import { z } from "zod";
import { getOrCreateArtistTx } from "#app/utils/artist-management.server";
import { prisma } from "#app/utils/db.server";
import { getServiceByName } from "./playlist-utils.server";

export const orphanMatchesSchema = z
  .array(
    z.object({
      action: z.enum(["match", "new", "skip"]),
      deletedItemId: z
        .string()
        .max(128)
        .optional()
        .transform((v) => (v === "" ? undefined : v)),
      selectedTrackId: z.string().nullable().optional(),
      position: z.number().int().min(0),
    }),
  )
  .max(200);

export type OrphanMatchSelection = {
  deletedItemId?: string | undefined;
  selectedTrackId?: string | null;
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
  const duplicateTrackIds = getDuplicateMatchedTrackIds(matches);
  if (duplicateTrackIds.length > 0) {
    return {
      success: false,
      processedCount: 0,
      message: "Each orphaned track can only be matched to one deleted video.",
      error: `Duplicate track selections: ${duplicateTrackIds.join(", ")}`,
    };
  }

  try {
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

    const service = await getServiceByName(playlist.service.name);
    const { createId } = await import("@paralleldrive/cuid2");

    const result = await prisma.$transaction(async (tx) => {
      let processedCount = 0;

      for (const match of matches) {
        if (match.action === "skip") {
          continue;
        }

        if (match.action === "new") {
          // Idempotency: if a row in this playlist already owns this
          // playlistItem.id (re-submit / stale confirm / later sync), treat the
          // match as already resolved instead of failing the whole batch.
          if (match.deletedItemId) {
            const itemIdOwner = await tx.servicePlaylistTrack.findFirst({
              where: { playlistId, playlistItemId: match.deletedItemId },
              select: { id: true },
            });
            if (itemIdOwner) continue;
          }

          const newTrackId = createId();
          // Never trust client input for the Track externalId (deletedItemId is a
          // playlistItem.id, not a video id, and could squat the unique key).
          const externalId = `deleted-${playlistId}-${newTrackId}`;

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
              playlistItemId: match.deletedItemId || null,
              position: match.position,
              isDeleted: true,
              deletedAt: new Date(),
            },
          });

          processedCount++;
        } else if (match.action === "match" && match.selectedTrackId) {
          // ADR-006 Edge Case 8: cross-playlist matching is not allowed. The
          // selected track must already be a member of THIS playlist (an
          // orphaned track is a ServicePlaylistTrack row for this playlist
          // that was not seen in the latest sync). Reject any client-supplied
          // track that is only in the global catalog.
          const existingPlaylistTrack = await tx.servicePlaylistTrack.findFirst(
            {
              where: {
                playlistId,
                trackId: match.selectedTrackId,
              },
              orderBy: [
                { isDeleted: "asc" },
                { position: "asc" },
                { id: "asc" },
              ],
            },
          );

          if (!existingPlaylistTrack) {
            throw new Error(
              `Track is not a member of this playlist: ${match.selectedTrackId}`,
            );
          }

          // The dialog offers candidate rows that are absent from the latest sync
          // but NOT deleted (deleted rows are filtered out, ADR-006 Edge Case 9).
          // Matching one marks it deleted and stamps the deleted item's
          // playlistItem.id (overwriting a stale one) so the next sync resolves
          // the item. Skip the stamp only if another row already owns that id.
          const itemIdOwner = match.deletedItemId
            ? await tx.servicePlaylistTrack.findFirst({
                where: { playlistId, playlistItemId: match.deletedItemId },
                select: { id: true },
              })
            : null;

          await tx.servicePlaylistTrack.update({
            where: { id: existingPlaylistTrack.id },
            data: {
              ...(match.deletedItemId && !itemIdOwner
                ? { playlistItemId: match.deletedItemId }
                : {}),
              position: match.position,
              isDeleted: true,
              deletedAt: existingPlaylistTrack.deletedAt || new Date(),
            },
          });

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
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return {
      success: false,
      processedCount: 0,
      message: `Failed to process matches. No changes were made. Please try again.`,
      error: errorMessage,
    };
  }
}
