import { prisma } from "#app/utils/db.server.ts";

export type GenreRef = {
  id: string;
  name: string;
};

/**
 * Ordered genre ids stored on TrackEdit. The first id is the primary genre,
 * which is also written to the legacy Track.genre string.
 */
export function snapshotGenreIds(
  genres: ReadonlyArray<GenreRef> | null | undefined,
  primaryName: string | null | undefined,
): string {
  const ordered = [...(genres ?? [])];
  if (primaryName) {
    const primaryIndex = ordered.findIndex((genre) => genre.name === primaryName);
    if (primaryIndex > 0) {
      const [primary] = ordered.splice(primaryIndex, 1);
      if (primary) ordered.unshift(primary);
    }
  }
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
