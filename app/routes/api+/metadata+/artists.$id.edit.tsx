import { data } from "react-router";
import { z } from "zod";
import { applyEntityEdit } from "#app/utils/apply-entity-edit.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/permissions.server.ts";
import { normalizeArtistName } from "#app/utils/normalize.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
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

  const { artist, edit } = await applyEntityEdit({
    request,
    entityType: "artist",
    entityId: artistId,
    userId,
    schema: EditArtistSchema,
    validationErrorStyle: "issues",
    verify: async () => {
      const existingArtist = await prisma.artist.findUnique({
        where: { id: artistId },
      });
      if (!existingArtist) {
        throw data({ error: "Artist not found" }, { status: 404 });
      }
    },
    notFoundMessage: "Artist not found",
    // Snapshot the current artist first so restore can recover the pre-edit values.
    loadBeforeWrite: (tx) => tx.artist.findUnique({ where: { id: artistId } }),
    createEdit: (tx, artistBeforeWrite, { comment }) =>
      tx.artistEdit.create({
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
      }),
    update: (tx, _before, { name, bio, genre, country, imageUrl, website }) =>
      tx.artist.update({
        where: { id: artistId },
        data: {
          name: name.trim(),
          normalizedName: normalizeArtistName(name),
          bio: bio !== undefined ? bio : undefined,
          genre: genre !== undefined ? genre : undefined,
          country: country !== undefined ? country : undefined,
          imageUrl: imageUrl !== undefined ? imageUrl : undefined,
          website: website !== undefined ? website : undefined,
        },
      }),
  });

  return data({ artist, edit });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
