import { normalizeGenreName } from "#app/utils/genre-migration.server.ts";
import { prisma } from "#app/utils/db.server.ts";

/** Attach one or more genres to a track for tests (replaces legacy `genre` on create). */
export async function linkGenresToTrack(trackId: string, genreNames: string | string[]) {
  const names = Array.isArray(genreNames) ? genreNames : [genreNames];
  for (const name of names) {
    const normalizedName = normalizeGenreName(name);
    const genre = await prisma.genre.upsert({
      where: { normalizedName },
      create: { name, normalizedName },
      update: {},
      select: { id: true },
    });
    await prisma.$executeRaw`INSERT OR IGNORE INTO _TrackGenres (A, B) VALUES (${genre.id}, ${trackId})`;
  }
}
