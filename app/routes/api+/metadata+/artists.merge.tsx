/**
 * POST /api/metadata/artists/merge
 * Merge a source artist into a target artist
 */

import { data } from "react-router";
import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import type { Route } from "./+types/artists.merge.ts";

const MergeArtistsSchema = z.object({
  sourceId: z.string().min(1, "Source artist ID is required"),
  targetId: z.string().min(1, "Target artist ID is required"),
  keepAsAlias: z.boolean().default(true),
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

  try {
    // Perform merge in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create audit entry before merge
      await tx.artistEdit.create({
        data: {
          artistId: sourceId,
          editedBy: userId,
          comment: `MERGE: ${comment}`,
          name: sourceArtist.name,
          bio: sourceArtist.bio,
          imageUrl: sourceArtist.imageUrl,
          website: sourceArtist.website,
          genre: sourceArtist.genre,
          country: sourceArtist.country,
        },
      });

      // Move all tracks from source to target
      const tracksUpdated = await tx.track.updateMany({
        where: { artistId: sourceId },
        data: { artistId: targetId },
      });

      // Move all albums from source to target
      const albumsUpdated = await tx.album.updateMany({
        where: { artistId: sourceId },
        data: { artistId: targetId },
      });

      // Mark source artist as merged
      await tx.artist.update({
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
          entityType: "artist",
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
        albumsUpdated: albumsUpdated.count,
      };
    });

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
    console.error("Error merging artists:", error);
    throw new Response("Failed to merge artists", { status: 500 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
