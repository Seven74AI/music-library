import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$id.restore.$editId.ts";

const RestoreSchema = z.object({
  comment: z.string().min(1, "Comment is required to explain why restoring"),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const userId = await requireCuratorRole(request);
  const { id: albumId, editId } = params;

  if (!albumId) {
    throw data({ error: "Album ID is required" }, { status: 400 });
  }

  if (!editId) {
    throw data({ error: "Edit ID is required" }, { status: 400 });
  }

  // Get and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = RestoreSchema.safeParse(body);
  if (!parseResult.success) {
    throw data(
      {
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { comment } = parseResult.data;

  // Verify album exists
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: {
      id: true,
      name: true,
      artistId: true,
      year: true,
      coverImageId: true,
    },
  });

  if (!album) {
    throw data({ error: "Album not found" }, { status: 404 });
  }

  // Verify edit exists and belongs to this album
  const editToRestore = await prisma.albumEdit.findUnique({
    where: { id: editId },
    select: {
      id: true,
      albumId: true,
      name: true,
      artistId: true,
      year: true,
      coverImageId: true,
    },
  });

  if (!editToRestore) {
    throw data({ error: "Edit not found" }, { status: 404 });
  }

  if (editToRestore.albumId !== albumId) {
    throw data({ error: "Edit does not belong to this album" }, { status: 400 });
  }

  // Verify artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: editToRestore.artistId },
    select: { id: true },
  });

  if (!artist) {
    throw data({ error: "Artist from restored version no longer exists" }, { status: 404 });
  }

  // Perform restore: create history entry with current state, then update album
  const result = await prisma.$transaction(async (tx) => {
    // Create history entry with current state (before restore)
    const editEntry = await tx.albumEdit.create({
      data: {
        albumId: album.id,
        editedBy: userId,
        comment: `Restore to version ${editId}: ${comment}`,
        // Snapshot current state
        name: album.name,
        artistId: album.artistId,
        year: album.year,
        coverImageId: album.coverImageId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    // Update album with restored data
    const updatedAlbum = await tx.album.update({
      where: { id: albumId },
      data: {
        name: editToRestore.name,
        artistId: editToRestore.artistId,
        year: editToRestore.year,
        coverImageId: editToRestore.coverImageId,
      },
    });

    return {
      album: updatedAlbum,
      edit: editEntry,
    };
  });

  return data(result);
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
