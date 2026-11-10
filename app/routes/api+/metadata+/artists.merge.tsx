/**
 * POST /api/metadata/artists/merge
 * Merge a source artist into a target artist
 */

import { data } from "react-router";
import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { executeCatalogEntityMerge } from "#app/features/metadata/merge-catalog-entity.server.ts";
import {
  EditLockTransactionError,
  editLockConflictCopyForEntity,
  findWriteBlockedLock,
  getLockStatus,
  throwEditLockTransactionError,
} from "#app/utils/locks.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import type { Route } from "./+types/artists.merge.ts";

const MergeArtistsSchema = z.object({
  sourceId: z.string().min(1, "Source artist ID is required"),
  targetId: z.string().min(1, "Target artist ID is required"),
  comment: z.string().min(1, "Comment is required to explain the merge"),
});

export async function action({ request }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);
  const userId = await requireUserId(request);

  const body = await request.json();
  const result = MergeArtistsSchema.safeParse(body);

  if (!result.success) {
    throw new Response(result.error.message, { status: 400 });
  }

  const { sourceId, targetId, comment } = result.data;

  const blockedLock = await findWriteBlockedLock(userId, [
    { entityType: "artist", entityId: sourceId },
    { entityType: "artist", entityId: targetId },
  ]);
  if (blockedLock) {
    throw new Response(
      JSON.stringify({
        error: "Locked",
        message: `${blockedLock.lockedByName} is currently editing this artist`,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate: cannot merge artist into itself
  if (sourceId === targetId) {
    throw new Response("Cannot merge an artist into itself", { status: 400 });
  }

  // Fetch both artists
  const [sourceArtist, targetArtist] = await Promise.all([
    prisma.artist.findUnique({
      where: { id: sourceId },
      include: {
        _count: {
          select: {
            tracks: true,
            albums: true,
          },
        },
      },
    }),
    prisma.artist.findUnique({
      where: { id: targetId },
    }),
  ]);

  if (!sourceArtist) {
    throw new Response("Source artist not found", { status: 404 });
  }

  if (!targetArtist) {
    throw new Response("Target artist not found", { status: 404 });
  }

  // Validate: target artist must not be merged
  if (targetArtist.mergedIntoId) {
    throw new Response("Target artist is already merged into another artist", {
      status: 400,
    });
  }

  // Validate: source artist must not be merged already
  if (sourceArtist.mergedIntoId) {
    throw new Response("Source artist is already merged", { status: 400 });
  }

  const [sourceLock, targetLock] = await Promise.all([
    getLockStatus("artist", sourceId),
    getLockStatus("artist", targetId),
  ]);

  try {
    // Perform merge in transaction
    const result = await prisma.$transaction(async (tx) =>
      executeCatalogEntityMerge(tx, {
        entityType: "artist",
        sourceId,
        targetId,
        comment,
        userId,
        sourceLock,
        targetLock,
        auditSnapshot: {
          name: sourceArtist.name,
          bio: sourceArtist.bio,
          imageUrl: sourceArtist.imageUrl,
          website: sourceArtist.website,
          genre: sourceArtist.genre,
          country: sourceArtist.country,
        },
      }),
    );

    return data({
      success: true,
      tracksUpdated: result.tracksUpdated,
      albumsUpdated: result.albumsUpdated,
      targetArtist: {
        id: targetArtist.id,
        name: targetArtist.name,
      },
    });
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      throwEditLockTransactionError(error, editLockConflictCopyForEntity("artist"));
    }
    console.error("Error merging artists:", error);
    throw new Response("Failed to merge artists", { status: 500 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
