/**
 * Genre Migration Utility
 *
 * Parses and normalizes genre names for the multi-genre tagging system.
 */

import { prisma } from "./db.server.ts";

/**
 * Normalize a genre name for deduplication and comparison
 */
export function normalizeGenreName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove special chars except spaces and hyphens
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Parse a genre string into an array of genre names
 * Handles various delimiters: comma, semicolon, slash, ampersand
 */
export function parseGenreString(genreString: string | null): string[] {
  if (!genreString || genreString.trim() === "") {
    return [];
  }

  // Split by common delimiters and clean up. Ampersand is deliberately NOT a
  // delimiter: it appears inside genre names ("R&B", "Drum & Bass").
  const genres = genreString
    .split(/[,;/]/) // Split by comma, semicolon, or slash
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map((g) => {
      // Capitalize first letter of each word
      return g
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    });

  // Remove duplicates (case-insensitive)
  const uniqueGenres = Array.from(new Map(genres.map((g) => [normalizeGenreName(g), g])).values());

  return uniqueGenres;
}

type LegacyTrackRow = { id: string; genre: string | null };

/**
 * Backfill `_TrackGenres` from legacy `Track.genre` strings (pre–ADR-037).
 * No-op when the `genre` column has already been dropped.
 */
export async function migrateTrackGenres(
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<{ tracksProcessed: number; genresCreated: number; linksCreated: number }> {
  const { batchSize = 100, onProgress } = options;

  let tracks: LegacyTrackRow[];
  try {
    tracks = await prisma.$queryRaw<LegacyTrackRow[]>`
      SELECT id, genre FROM "Track"
      WHERE genre IS NOT NULL AND trim(genre) != ''
    `;
  } catch {
    return { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 };
  }

  const totalTracks = tracks.length;
  let tracksProcessed = 0;
  let genresCreated = 0;
  let linksCreated = 0;
  const genreCache = new Map<string, string>();

  for (let offset = 0; offset < totalTracks; offset += batchSize) {
    const batch = tracks.slice(offset, offset + batchSize);

    for (const track of batch) {
      const genreNames = parseGenreString(track.genre);

      for (const genreName of genreNames) {
        const normalizedName = normalizeGenreName(genreName);
        let genreId = genreCache.get(normalizedName);

        if (!genreId) {
          const existingGenre = await prisma.genre.findFirst({
            where: { normalizedName },
            select: { id: true },
          });

          if (existingGenre) {
            genreId = existingGenre.id;
          } else {
            const newGenre = await prisma.genre.create({
              data: { name: genreName, normalizedName },
              select: { id: true },
            });
            genreId = newGenre.id;
            genresCreated++;
          }

          genreCache.set(normalizedName, genreId);
        }

        const existingLink = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM _TrackGenres
          WHERE A = ${genreId} AND B = ${track.id}
        `;

        if (Number(existingLink[0]?.count) === 0) {
          await prisma.$executeRaw`
            INSERT INTO _TrackGenres (A, B) VALUES (${genreId}, ${track.id})
          `;
          linksCreated++;
        }
      }
    }

    tracksProcessed += batch.length;
    onProgress?.(tracksProcessed, totalTracks);
  }

  return { tracksProcessed, genresCreated, linksCreated };
}
