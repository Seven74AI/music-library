import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import {
  assertEditLockInTransaction,
  EditLockTransactionError,
  editLockConflictCopyForEntity,
  findWriteBlockedLock,
  getLockStatus,
  throwEditLockTransactionError,
} from "#app/utils/locks.server.ts";
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

  const userId = await requireCuratorRole(request);
  const { id: imageId } = params;

  if (!imageId) {
    throw data({ error: "Image ID is required" }, { status: 400 });
  }

  // Parse and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  }
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

  const blockedLock = await findWriteBlockedLock(userId, [{ entityType, entityId }]);
  if (blockedLock) {
    throw data(
      {
        error: "Locked",
        message: `${blockedLock.lockedByName} is currently editing this ${entityType}`,
      },
      { status: 409 },
    );
  }

  // Verify image exists
  const image = await prisma.coverImage.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw data({ error: "Image not found" }, { status: 404 });
  }

  const lock = await getLockStatus(entityType, entityId);

  try {
    // Update the entity's primary-cover pointer. A shared CoverImage (deduplicated
    // by contentHash) cannot carry per-album/per-track primary state, so the
    // nullable FK on the entity is the single source of truth.
    await prisma.$transaction(async (tx) => {
      await assertEditLockInTransaction(tx, entityType, entityId, userId, lock);

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
          select: { coverImageId: true },
        });

        if (!album) {
          throw data({ error: "Album not found" }, { status: 404 });
        }

        // The album's `coverImageId` FK is the per-album primary cover pointer.
        await tx.album.update({
          where: { id: entityId },
          data: {
            coverImageId: imageId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      throwEditLockTransactionError(error, editLockConflictCopyForEntity(entityType));
    }
    throw error;
  }

  return data({ success: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
