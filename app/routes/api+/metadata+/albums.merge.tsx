/**
 * POST /api/metadata/albums/merge
 * Merge a source album into a target album
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
import type { Route } from "./+types/albums.merge.ts";

const MergeAlbumsSchema = z.object({
  sourceId: z.string().min(1, "Source album ID is required"),
  targetId: z.string().min(1, "Target album ID is required"),
  comment: z.string().min(1, "Comment is required to explain the merge"),
});

export async function action({ request }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);
  const userId = await requireUserId(request);

  const body = await request.json();
  const result = MergeAlbumsSchema.safeParse(body);

  if (!result.success) {
    throw new Response(result.error.message, { status: 400 });
  }

  const { sourceId, targetId, comment } = result.data;

  const blockedLock = await findWriteBlockedLock(userId, [
    { entityType: "album", entityId: sourceId },
    { entityType: "album", entityId: targetId },
  ]);
  if (blockedLock) {
    throwEditLockTransactionError(
      new EditLockTransactionError({
        kind: "other",
        lockedByName: blockedLock.lockedByName,
      }),
      editLockConflictCopyForEntity("album"),
    );
  }

  // Validate: cannot merge album into itself
  if (sourceId === targetId) {
    throw new Response("Cannot merge an album into itself", { status: 400 });
  }

  // Fetch both albums
  const [sourceAlbum, targetAlbum] = await Promise.all([
    prisma.album.findUnique({
      where: { id: sourceId },
      include: {
        _count: {
          select: {
            tracks: true,
          },
        },
      },
    }),
    prisma.album.findUnique({
      where: { id: targetId },
    }),
  ]);

  if (!sourceAlbum) {
    throw new Response("Source album not found", { status: 404 });
  }

  if (!targetAlbum) {
    throw new Response("Target album not found", { status: 404 });
  }

  // Validate: target album must not be merged
  if (targetAlbum.mergedIntoId) {
    throw new Response("Target album is already merged into another album", {
      status: 400,
    });
  }

  // Validate: source album must not be merged already
  if (sourceAlbum.mergedIntoId) {
    throw new Response("Source album is already merged", { status: 400 });
  }

  // Validate: both albums must belong to the same artist. Merging albums from
  // different artists would move tracks into another artist's album while each
  // track keeps its own artistId, silently corrupting artist attribution.
  if (sourceAlbum.artistId !== targetAlbum.artistId) {
    throw new Response("Cannot merge albums from different artists — merge the artists first", {
      status: 400,
    });
  }

  const [sourceLock, targetLock] = await Promise.all([
    getLockStatus("album", sourceId),
    getLockStatus("album", targetId),
  ]);

  try {
    // Perform merge in transaction
    const result = await prisma.$transaction(async (tx) =>
      executeCatalogEntityMerge(tx, {
        entityType: "album",
        sourceId,
        targetId,
        comment,
        userId,
        sourceLock,
        targetLock,
        auditSnapshot: {
          name: sourceAlbum.name,
          artistId: sourceAlbum.artistId,
          year: sourceAlbum.year,
          coverImageId: sourceAlbum.coverImageId,
        },
      }),
    );

    return data({
      success: true,
      tracksUpdated: result.tracksUpdated,
      targetAlbum: {
        id: targetAlbum.id,
        name: targetAlbum.name,
      },
    });
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      throwEditLockTransactionError(error, editLockConflictCopyForEntity("album"));
    }
    console.error("Error merging albums:", error);
    throw new Response("Failed to merge albums", { status: 500 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
