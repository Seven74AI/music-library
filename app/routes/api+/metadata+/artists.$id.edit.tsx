import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/permissions.server.ts";
import { normalizeArtistName } from "#app/utils/normalize.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  assertEditLockInTransaction,
  EditLockTransactionError,
  editLockConflictCopyForEntity,
  getLockStatus,
  releaseLock,
  throwEditLockTransactionError,
} from "#app/utils/locks.server.ts";
import { type Route } from "./+types/artists.$id.edit.ts";

const EditArtistSchema = z.object({
  name: z.string().min(1, "Name is required"),
  bio: z.string().nullable().optional(),
  genre: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  comment: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireCuratorOrAdmin(request);

  const { id: artistId } = params;

  if (!artistId) {
    throw data({ error: "Artist ID is required" }, { status: 400 });
  }

  // Parse and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = EditArtistSchema.safeParse(body);

  if (!result.success) {
    throw data(
      {
        error: "Validation failed",
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  const { name, bio, genre, country, imageUrl, website, comment } = result.data;

  // Check if artist exists
  const existingArtist = await prisma.artist.findUnique({
    where: { id: artistId },
  });

  if (!existingArtist) {
    throw data({ error: "Artist not found" }, { status: 404 });
  }

  // Reject the edit if another curator holds the lock (ADR-032).
  const lock = await getLockStatus("artist", artistId);
  if (lock && lock.lockedBy !== userId) {
    throw data(
      {
        error: "Locked",
        message: `${lock.lockedByName} is currently editing this artist`,
      },
      { status: 409 },
    );
  }

  // Snapshot the current artist first so restore can recover the pre-edit values.
  let artist: Awaited<ReturnType<typeof prisma.artist.update>>;
  let edit: Awaited<ReturnType<typeof prisma.artistEdit.create>>;
  try {
    ({ artist, edit } = await prisma.$transaction(async (tx) => {
      await assertEditLockInTransaction(tx, "artist", artistId, userId, lock);

      const artistBeforeWrite = await tx.artist.findUnique({
        where: { id: artistId },
      });
      if (!artistBeforeWrite) {
        throw data({ error: "Artist not found" }, { status: 404 });
      }

      const artistEdit = await tx.artistEdit.create({
        data: {
          artistId,
          editedBy: userId,
          comment: comment || null,
          name: artistBeforeWrite.name,
          bio: artistBeforeWrite.bio,
          imageUrl: artistBeforeWrite.imageUrl,
          website: artistBeforeWrite.website,
          genre: artistBeforeWrite.genre,
          country: artistBeforeWrite.country,
        },
      });

      const normalizedName = normalizeArtistName(name);
      const updatedArtist = await tx.artist.update({
        where: { id: artistId },
        data: {
          name: name.trim(),
          normalizedName,
          bio: bio !== undefined ? bio : undefined,
          genre: genre !== undefined ? genre : undefined,
          country: country !== undefined ? country : undefined,
          imageUrl: imageUrl !== undefined ? imageUrl : undefined,
          website: website !== undefined ? website : undefined,
        },
      });

      return { artist: updatedArtist, edit: artistEdit };
    }));
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      throwEditLockTransactionError(error, editLockConflictCopyForEntity("artist"));
    }
    throw error;
  }

  // Release the lock on successful save (ADR-032).
  if (lock) {
    await releaseLock("artist", artistId, userId, {
      lockId: lock.id,
      acquiredAt: lock.acquiredAt,
    });
  }

  return data({ artist, edit });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
