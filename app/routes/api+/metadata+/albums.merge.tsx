/**
 * POST /api/metadata/albums/merge
 * Merge a source album into a target album
 */

import { data } from "react-router";
import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import type { Route } from "./+types/albums.merge.ts";

const MergeAlbumsSchema = z.object({
  sourceId: z.string().min(1, "Source album ID is required"),
  targetId: z.string().min(1, "Target album ID is required"),
  keepAsAlias: z.boolean().default(true),
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

  try {
    // Perform merge in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create audit entry before merge
      await tx.albumEdit.create({
        data: {
          albumId: sourceId,
          editedBy: userId,
          comment: `MERGE: ${comment}`,
          name: sourceAlbum.name,
          artistId: sourceAlbum.artistId,
          year: sourceAlbum.year,
          coverImageId: sourceAlbum.coverImageId,
        },
      });

      // Move all tracks from source to target
      const tracksUpdated = await tx.track.updateMany({
        where: { albumId: sourceId },
        data: { albumId: targetId },
      });

      // Mark source album as merged
      await tx.album.update({
        where: { id: sourceId },
        data: {
          mergedIntoId: targetId,
          mergedAt: new Date(),
          mergedBy: userId,
        },
      });

      // Update duplicate detection status for this pair
      await tx.duplicateDetection.updateMany({
        where: {
          entityType: "album",
          OR: [
            { entityId1: sourceId, entityId2: targetId },
            { entityId1: targetId, entityId2: sourceId },
          ],
        },
        data: {
          status: "merged",
        },
      });

      return {
        tracksUpdated: tracksUpdated.count,
      };
    });

    return data({
      success: true,
      tracksUpdated: result.tracksUpdated,
      targetAlbum: {
        id: targetAlbum.id,
        name: targetAlbum.name,
      },
    });
  } catch (error) {
    console.error("Error merging albums:", error);
    throw new Response("Failed to merge albums", { status: 500 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
