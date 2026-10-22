import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$id.set-primary.ts";

const SetPrimarySchema = z.object({
  entityType: z.enum(["artist", "album"], { message: "entityType must be 'artist' or 'album'" }),
  entityId: z.string().min(1, "entityId is required"),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "PUT") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  await requireCuratorRole(request);
  const { id: imageId } = params;

  if (!imageId) {
    throw data({ error: "Image ID is required" }, { status: 400 });
  }

  // Parse and validate request body
  const body = await request.json();
  const result = SetPrimarySchema.safeParse(body);

  if (!result.success) {
    throw data(
      {
        error: "Validation failed",
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  const { entityType, entityId } = result.data;

  // Verify image exists
  const image = await prisma.coverImage.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw data({ error: "Image not found" }, { status: 404 });
  }

  // Update isPrimary for all images of this entity
  await prisma.$transaction(async (tx) => {
    // First, set all images for this entity to non-primary
    if (entityType === "artist") {
      // Find artist
      const artist = await tx.artist.findUnique({
        where: { id: entityId },
      });

      if (!artist) {
        throw data({ error: "Artist not found" }, { status: 404 });
      }

      // Currently artists only have a single imageUrl field, not multiple images
      // Update the artist's imageUrl to the selected image's objectKey
      await tx.artist.update({
        where: { id: entityId },
        data: {
          imageUrl: image.objectKey,
        },
      });
    } else if (entityType === "album") {
      // Find album
      const album = await tx.album.findUnique({
        where: { id: entityId },
      });

      if (!album) {
        throw data({ error: "Album not found" }, { status: 404 });
      }

      // Update all related cover images to non-primary
      await tx.coverImage.updateMany({
        where: {
          id: {
            in: (
              await tx.album.findMany({ where: { id: entityId }, select: { coverImageId: true } })
            )
              .map((a) => a.coverImageId)
              .filter(Boolean) as string[],
          },
        },
        data: {
          isPrimary: false,
        },
      });

      // Set the selected image as primary
      await tx.coverImage.update({
        where: { id: imageId },
        data: {
          isPrimary: true,
        },
      });

      // Update the album's coverImageId
      await tx.album.update({
        where: { id: entityId },
        data: {
          coverImageId: imageId,
        },
      });
    }
  });

  return data({ success: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
