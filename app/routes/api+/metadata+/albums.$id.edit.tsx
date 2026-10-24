import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { getLockStatus, releaseLock } from "#app/utils/locks.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/albums.$id.edit.ts";

const EditAlbumSchema = z.object({
  name: z.string().min(1, "Name is required"),
  artistId: z.string().min(1, "Artist ID is required"),
  year: z.number().nullable().optional(),
  coverImageId: z.string().nullable().optional(),
  comment: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireCuratorOrAdmin(request);

  const { id: albumId } = params;

  if (!albumId) {
    throw data({ error: "Album ID is required" }, { status: 400 });
  }

  // Parse and validate request body
  const body = await request.json();
  const result = EditAlbumSchema.safeParse(body);

  if (!result.success) {
    throw data(
      {
        error: "Validation failed",
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  const { name, artistId, year, coverImageId, comment } = result.data;

  // Check if album exists
  const existingAlbum = await prisma.album.findUnique({
    where: { id: albumId },
  });

  if (!existingAlbum) {
    throw data({ error: "Album not found" }, { status: 404 });
  }

  // Verify artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
  });

  if (!artist) {
    throw data({ error: "Artist not found" }, { status: 404 });
  }

  // Reject the edit if another curator holds the lock (ADR-032).
  const lock = await getLockStatus("album", albumId);
  if (lock && lock.lockedBy !== userId) {
    throw data(
      {
        error: "Locked",
        message: `${lock.lockedByName} is currently editing this album`,
      },
      { status: 409 },
    );
  }

  // Snapshot the current album first so restore can recover the pre-edit values.
  const { album, edit } = await prisma.$transaction(async (tx) => {
    const albumEdit = await tx.albumEdit.create({
      data: {
        albumId,
        editedBy: userId,
        comment: comment || null,
        name: existingAlbum.name,
        artistId: existingAlbum.artistId,
        year: existingAlbum.year,
        coverImageId: existingAlbum.coverImageId,
      },
    });

    const updatedAlbum = await tx.album.update({
      where: { id: albumId },
      data: {
        name: name.trim(),
        artistId,
        year: year !== undefined ? year : undefined,
        coverImageId: coverImageId !== undefined ? coverImageId : undefined,
      },
    });

    return { album: updatedAlbum, edit: albumEdit };
  });

  // Release the lock on successful save (ADR-032).
  await releaseLock("album", albumId, userId);

  return data({ album, edit });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
