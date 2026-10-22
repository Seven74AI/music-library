import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { normalizeArtistName } from "#app/utils/artist-management.server.ts";
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
  const { id: artistId, editId } = params;

  if (!artistId) {
    throw data({ error: "Artist ID is required" }, { status: 400 });
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

  // Verify artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: {
      id: true,
      name: true,
      bio: true,
      genre: true,
      country: true,
      imageUrl: true,
      website: true,
    },
  });

  if (!artist) {
    throw data({ error: "Artist not found" }, { status: 404 });
  }

  // Verify edit exists and belongs to this artist
  const editToRestore = await prisma.artistEdit.findUnique({
    where: { id: editId },
    select: {
      id: true,
      artistId: true,
      name: true,
      bio: true,
      genre: true,
      country: true,
      imageUrl: true,
      website: true,
    },
  });

  if (!editToRestore) {
    throw data({ error: "Edit not found" }, { status: 404 });
  }

  if (editToRestore.artistId !== artistId) {
    throw data({ error: "Edit does not belong to this artist" }, { status: 400 });
  }

  // Perform restore: create history entry with current state, then update artist
  const result = await prisma.$transaction(async (tx) => {
    // Create history entry with current state (before restore)
    const editEntry = await tx.artistEdit.create({
      data: {
        artistId: artist.id,
        editedBy: userId,
        comment: `Restore to version ${editId}: ${comment}`,
        // Snapshot current state
        name: artist.name,
        bio: artist.bio,
        genre: artist.genre,
        country: artist.country,
        imageUrl: artist.imageUrl,
        website: artist.website,
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

    // Update artist with restored data
    const normalizedName = normalizeArtistName(editToRestore.name);
    const updatedArtist = await tx.artist.update({
      where: { id: artistId },
      data: {
        name: editToRestore.name,
        normalizedName,
        bio: editToRestore.bio,
        genre: editToRestore.genre,
        country: editToRestore.country,
        imageUrl: editToRestore.imageUrl,
        website: editToRestore.website,
      },
    });

    return {
      artist: updatedArtist,
      edit: editEntry,
    };
  });

  return data(result);
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
