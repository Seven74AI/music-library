import { data } from "react-router";
import { z } from "zod";
import { applyEntityEdit } from "#app/utils/apply-entity-edit.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/albums.$id.edit.ts";

const EditAlbumSchema = z.object({
  name: z.string().min(1, "Name is required"),
  artistId: z.string().min(1, "Artist ID is required"),
  year: z.number().int().nullable().optional(),
  coverImageId: z.string().nullable().optional(),
  comment: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireCuratorOrAdmin(request);

  const { id: albumId } = params;

  if (!albumId) {
    throw data({ error: "Album ID is required" }, { status: 400 });
  }

  const { album, edit } = await applyEntityEdit({
    request,
    entityType: "album",
    entityId: albumId,
    userId,
    schema: EditAlbumSchema,
    validationErrorStyle: "issues",
    verify: async ({ artistId }) => {
      const existingAlbum = await prisma.album.findUnique({
        where: { id: albumId },
      });
      if (!existingAlbum) {
        throw data({ error: "Album not found" }, { status: 404 });
      }

      const artist = await prisma.artist.findUnique({
        where: { id: artistId },
      });
      if (!artist) {
        throw data({ error: "Artist not found" }, { status: 404 });
      }
    },
    notFoundMessage: "Album not found",
    // Snapshot the current album first so restore can recover the pre-edit values.
    loadBeforeWrite: (tx) => tx.album.findUnique({ where: { id: albumId } }),
    createEdit: (tx, albumBeforeWrite, { comment }) =>
      tx.albumEdit.create({
        data: {
          albumId,
          editedBy: userId,
          comment: comment || null,
          name: albumBeforeWrite.name,
          artistId: albumBeforeWrite.artistId,
          year: albumBeforeWrite.year,
          coverImageId: albumBeforeWrite.coverImageId,
        },
      }),
    update: (tx, _before, { name, artistId, year, coverImageId }) =>
      tx.album.update({
        where: { id: albumId },
        data: {
          name: name.trim(),
          artistId,
          year: year !== undefined ? year : undefined,
          coverImageId: coverImageId !== undefined ? coverImageId : undefined,
        },
      }),
  });

  return data({ album, edit });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
