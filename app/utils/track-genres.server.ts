import { Prisma } from "#prisma/client.js";
import { normalizeGenreName, parseGenreString } from "#app/utils/genre-migration.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { isUniqueConstraintError } from "#app/utils/prisma-errors.ts";

export type GenreRef = {
  id: string;
  name: string;
};

type GenreWriteClient = {
  genre: {
    findFirst: typeof prisma.genre.findFirst;
    create: typeof prisma.genre.create;
  };
  $executeRaw: typeof prisma.$executeRaw;
};

type DbLike = GenreWriteClient & {
  $transaction?: typeof prisma.$transaction;
};

/**
 * Ordered genre ids stored on TrackEdit. The first id is the primary genre.
 */
export function snapshotGenreIds(genres: ReadonlyArray<GenreRef> | null | undefined): string {
  const ordered = [...(genres ?? [])];
  return JSON.stringify(ordered.map((genre) => genre.id));
}

export function primaryGenreName(genres: ReadonlyArray<{ name: string }>): string | null {
  return genres[0]?.name ?? null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

export function parseGenreIdSnapshot(
  value: string | null | undefined,
): { status: "absent" } | { status: "present"; ids: string[] } | { status: "invalid" } {
  if (value == null) return { status: "absent" };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isStringArray(parsed)) return { status: "invalid" };
    return { status: "present", ids: parsed };
  } catch {
    return { status: "invalid" };
  }
}

export async function resolveOrderedGenresFromNames(
  genreNames: string[],
): Promise<{ ok: true; genres: GenreRef[] } | { ok: false }> {
  const names = genreNames.flatMap((value) => parseGenreString(value));
  if (names.length === 0) {
    return { ok: true, genres: [] };
  }

  const genres: GenreRef[] = [];
  for (const name of names) {
    const normalizedName = normalizeGenreName(name);
    const existing = await prisma.genre.findFirst({
      where: { normalizedName },
      select: { id: true, name: true },
    });
    if (existing) {
      genres.push(existing);
      continue;
    }
    try {
      const created = await prisma.genre.create({
        data: { name, normalizedName },
        select: { id: true, name: true },
      });
      genres.push(created);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await prisma.genre.findFirst({
          where: { normalizedName },
          select: { id: true, name: true },
        });
        if (!winner) throw error;
        genres.push(winner);
        continue;
      }
      throw error;
    }
  }
  return { ok: true, genres };
}

export async function resolveOrderedGenres(
  genreIds: string[],
): Promise<{ ok: true; genres: GenreRef[] } | { ok: false }> {
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const id of genreIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }

  if (uniqueIds.length === 0) {
    return { ok: true, genres: [] };
  }

  const genres = await prisma.genre.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true },
  });

  if (genres.length !== uniqueIds.length) {
    return { ok: false };
  }

  const byId = new Map(genres.map((genre) => [genre.id, genre]));
  const ordered: GenreRef[] = [];
  for (const id of uniqueIds) {
    const genre = byId.get(id);
    if (!genre) return { ok: false };
    ordered.push(genre);
  }

  return { ok: true, genres: ordered };
}

async function replaceTrackGenreLinksOnClient(
  tx: GenreWriteClient,
  trackId: string,
  genreInput: string | string[] | null | undefined,
): Promise<void> {
  const names =
    typeof genreInput === "string"
      ? parseGenreString(genreInput)
      : Array.isArray(genreInput)
        ? genreInput.flatMap((value) => parseGenreString(value))
        : [];

  await tx.$executeRaw`
    DELETE FROM _TrackGenres WHERE B = ${trackId}
  `;

  if (names.length === 0) return;

  const genreIds: string[] = [];
  const seenGenreIds = new Set<string>();
  for (const name of names) {
    const genreId = await findOrCreateGenre(tx, name);
    if (seenGenreIds.has(genreId)) continue;
    seenGenreIds.add(genreId);
    genreIds.push(genreId);
  }

  await tx.$executeRaw`
    INSERT INTO _TrackGenres (A, B) VALUES ${Prisma.join(
      genreIds.map((genreId) => Prisma.sql`(${genreId}, ${trackId})`),
    )}
  `;
}

async function findOrCreateGenre(tx: GenreWriteClient, genreName: string): Promise<string> {
  const normalizedName = normalizeGenreName(genreName);
  const existing = await tx.genre.findFirst({
    where: { normalizedName },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.genre.create({
    data: { name: genreName, normalizedName },
    select: { id: true },
  });
  return created.id;
}

/**
 * Replace a track's genre links from human-readable genre strings (audio tags, uploads).
 */
export async function replaceTrackGenresFromStrings(
  client: DbLike,
  trackId: string,
  genreInput: string | string[] | null | undefined,
): Promise<void> {
  if (client.$transaction) {
    await client.$transaction((tx) => replaceTrackGenreLinksOnClient(tx, trackId, genreInput));
    return;
  }

  await replaceTrackGenreLinksOnClient(client, trackId, genreInput);
}
