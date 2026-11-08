import { data } from "react-router";
import { z } from "zod";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/merge.ts";

const MergeGenresSchema = z.object({
  sourceIds: z.array(z.string()).min(1, "At least one source genre is required"),
  targetId: z.string().min(1, "Target genre is required"),
});

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/**
 * POST /api/genres/merge
 * Merge multiple genres into one target genre
 * - All tracks linked to source genres will be relinked to target
 * - Source genres will be deleted
 */
export async function action({ request }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);

  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const parseResult = MergeGenresSchema.safeParse(body);

  if (!parseResult.success) {
    throw data(
      {
        error: "Validation failed",
        details: parseResult.error.issues,
      },
      { status: 400 },
    );
  }

  const { sourceIds, targetId } = parseResult.data;

  // Validate that target is not in sources
  if (sourceIds.includes(targetId)) {
    throw data(
      {
        error: "Target genre cannot be one of the source genres",
      },
      { status: 400 },
    );
  }

  // Verify all genres exist
  const allIds = [...sourceIds, targetId];
  const genres = await prisma.genre.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  if (genres.length !== allIds.length) {
    const foundIds = new Set(genres.map((g) => g.id));
    const missingIds = allIds.filter((id) => !foundIds.has(id));
    throw data(
      {
        error: "Some genres not found",
        missingIds,
      },
      { status: 404 },
    );
  }

  const targetGenre = genres.find((g) => g.id === targetId);
  const sourceGenres = genres.filter((g) => sourceIds.includes(g.id));

  if (!targetGenre) {
    throw data(
      {
        error: "Target genre not found",
      },
      { status: 404 },
    );
  }

  // Perform merge in a transaction
  const result = await prisma.$transaction(async (tx) => {
    let tracksRelinked = 0;

    // For each source genre
    for (const sourceGenre of sourceGenres) {
      // Relink every track linked to this source genre to the target genre in
      // one set-based INSERT..SELECT..WHERE NOT EXISTS (avoids N+1 SELECT/INSERT
      // per track). `$executeRaw` returns the number of inserted rows.
      const inserted = await tx.$executeRaw`
        INSERT INTO _TrackGenres (A, B)
        SELECT ${targetId}, src.B
        FROM _TrackGenres AS src
        WHERE src.A = ${sourceGenre.id}
          AND NOT EXISTS (
            SELECT 1
            FROM _TrackGenres AS tgt
            WHERE tgt.A = ${targetId} AND tgt.B = src.B
          )
      `;
      tracksRelinked += inserted;

      // Remove all links to the source genre in one DELETE.
      await tx.$executeRaw`
        DELETE FROM _TrackGenres WHERE A = ${sourceGenre.id}
      `;

      // Delete source genre (should have no more links now)
      await tx.genre.delete({
        where: { id: sourceGenre.id },
      });
    }

    // Get updated target genre with count
    const updatedTarget = await tx.genre.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            tracks: true,
          },
        },
      },
    });

    return {
      targetGenre: updatedTarget ?? null,
      tracksRelinked,
      sourceGenresDeleted: sourceGenres.length,
    };
  });

  return Response.json({
    success: true,
    message: `Merged ${result.sourceGenresDeleted} genre(s) into "${result.targetGenre?.name ?? "unknown"}"`,
    targetGenre: result.targetGenre
      ? {
          id: result.targetGenre.id,
          name: result.targetGenre.name,
          trackCount: result.targetGenre._count.tracks,
        }
      : null,
    tracksRelinked: result.tracksRelinked,
    sourceGenresDeleted: result.sourceGenresDeleted,
  });
}
