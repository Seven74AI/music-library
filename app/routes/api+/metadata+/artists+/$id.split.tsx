/**
 * POST /api/metadata/artists/:id/split
 * Split an artist by moving selected tracks to a new artist
 */

import { data } from "react-router";
import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  assertEditLockInTransaction,
  EDIT_LOCK_CONFLICT_COPY_SPLIT,
  EditLockTransactionError,
  findWriteBlockedLock,
  getLockStatus,
  throwEditLockTransactionError,
  type LockInfo,
} from "#app/utils/locks.server.ts";
import { normalizeArtistName } from "#app/utils/normalize.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import type { Route } from "./+types/$id.split.ts";

const SplitArtistSchema = z.object({
  trackIds: z.array(z.string()).min(1, "At least one track must be selected"),
  newArtistName: z.string().min(1, "New artist name is required"),
  comment: z.string().min(1, "Comment is required to explain the split"),
});

export async function action({ request, params }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);
  const userId = await requireUserId(request);

  const { id: artistId } = params;

  if (!artistId) {
    throw new Response("Artist ID is required", { status: 400 });
  }

  const body = await request.json();
  const result = SplitArtistSchema.safeParse(body);

  if (!result.success) {
    throw new Response(result.error.message, { status: 400 });
  }

  const { trackIds: rawTrackIds, newArtistName, comment } = result.data;
  const trackIds = [...new Set(rawTrackIds)];

  const blockedLock = await findWriteBlockedLock(userId, [
    { entityType: "artist", entityId: artistId },
    ...trackIds.map((entityId) => ({ entityType: "track" as const, entityId })),
  ]);
  if (blockedLock) {
    throwEditLockTransactionError(
      new EditLockTransactionError({
        kind: "other",
        lockedByName: blockedLock.lockedByName,
      }),
      EDIT_LOCK_CONFLICT_COPY_SPLIT,
    );
  }

  // Fetch the original artist
  const originalArtist = await prisma.artist.findUnique({
    where: { id: artistId },
    include: {
      tracks: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!originalArtist) {
    throw new Response("Artist not found", { status: 404 });
  }

  // Validate that all track IDs belong to this artist
  const artistTrackIds = new Set(originalArtist.tracks.map((t) => t.id));
  const invalidTrackIds = trackIds.filter((id) => !artistTrackIds.has(id));

  if (invalidTrackIds.length > 0) {
    throw new Response(`Some tracks do not belong to this artist: ${invalidTrackIds.join(", ")}`, {
      status: 400,
    });
  }

  // Validate that we're not moving all tracks (artist would be empty)
  if (trackIds.length === originalArtist.tracks.length) {
    throw new Response(
      "Cannot move all tracks. Use rename instead if you want to change the artist name.",
      { status: 400 },
    );
  }

  const artistLock = await getLockStatus("artist", artistId);
  const trackLocks: Array<{ entityId: string; lock: LockInfo | null }> = await Promise.all(
    trackIds.map(async (entityId) => ({
      entityId,
      lock: await getLockStatus("track", entityId),
    })),
  );

  try {
    // Perform split in transaction
    const result = await prisma.$transaction(async (tx) => {
      await assertEditLockInTransaction(tx, "artist", artistId, userId, artistLock);
      for (const { entityId, lock } of trackLocks) {
        await assertEditLockInTransaction(tx, "track", entityId, userId, lock);
      }

      // Create audit entry before split
      await tx.artistEdit.create({
        data: {
          artistId: originalArtist.id,
          editedBy: userId,
          comment: `SPLIT: ${comment}`,
          name: originalArtist.name,
          bio: originalArtist.bio,
          imageUrl: originalArtist.imageUrl,
          website: originalArtist.website,
          genre: originalArtist.genre,
          country: originalArtist.country,
        },
      });

      // Create the new artist
      const newArtist = await tx.artist.create({
        data: {
          name: newArtistName,
          normalizedName: normalizeArtistName(newArtistName),
        },
      });

      // Create audit entry for new artist
      await tx.artistEdit.create({
        data: {
          artistId: newArtist.id,
          editedBy: userId,
          comment: `CREATED via split from "${originalArtist.name}": ${comment}`,
          name: newArtist.name,
          bio: newArtist.bio,
          imageUrl: newArtist.imageUrl,
          website: newArtist.website,
          genre: newArtist.genre,
          country: newArtist.country,
        },
      });

      // Move selected tracks to new artist
      const tracksUpdated = await tx.track.updateMany({
        where: {
          id: { in: trackIds },
          artistId: originalArtist.id,
        },
        data: {
          artistId: newArtist.id,
        },
      });

      return {
        newArtist,
        tracksUpdated: tracksUpdated.count,
      };
    });

    return data({
      success: true,
      newArtist: {
        id: result.newArtist.id,
        name: result.newArtist.name,
      },
      tracksUpdated: result.tracksUpdated,
    });
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      throwEditLockTransactionError(error, EDIT_LOCK_CONFLICT_COPY_SPLIT);
    }
    console.error("Error splitting artist:", error);
    throw new Response("Failed to split artist", { status: 500 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
