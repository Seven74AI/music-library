/**
 * Genre Migration Utility
 *
 * Parses and normalizes genre names for the multi-genre tagging system.
 */

import { type PrismaClient } from "#prisma/client.js";
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

const DROP_TRACK_GENRE_MIGRATION = "20261108160000_drop_track_genre";

type DbClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "genre">;

/** Whether `Track.genre` still exists (pre–ADR-037 column drop). */
export async function trackGenreColumnExists(client: DbClient = prisma): Promise<boolean> {
  const columns = await client.$queryRaw<Array<{ name: string }>>`PRAGMA table_info('Track')`;
  return columns.some((column) => column.name === "genre");
}

/** True when the drop migration has not been applied yet. */
export async function isDropTrackGenreMigrationPending(
  client: DbClient = prisma,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `;
  return !rows.some((row) => row.migration_name === DROP_TRACK_GENRE_MIGRATION);
}

/**
 * Backfill `_TrackGenres` from legacy `Track.genre` before the column-drop migration runs.
 * Idempotent — safe to call multiple times.
 */
export async function backfillLegacyTrackGenresIfNeeded(): Promise<{
  ran: boolean;
  result: { tracksProcessed: number; genresCreated: number; linksCreated: number };
}> {
  if (!(await trackGenreColumnExists()) || !(await isDropTrackGenreMigrationPending())) {
    return {
      ran: false,
      result: { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 },
    };
  }

  const result = await migrateTrackGenres();
  return { ran: true, result };
}

/**
 * Migrate track genres from the legacy scalar column into `_TrackGenres`.
 * Merges with existing M2M links (does not skip tracks that already have genres).
 */
export async function migrateTrackGenres(
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
    client?: DbClient;
  } = {},
): Promise<{ tracksProcessed: number; genresCreated: number; linksCreated: number }> {
  const { batchSize = 100, onProgress, client = prisma } = options;

  if (!(await trackGenreColumnExists(client))) {
    return { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 };
  }

  const totalRow = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM Track WHERE genre IS NOT NULL AND trim(genre) != ''
  `;
  const totalTracks = Number(totalRow[0]?.count ?? 0);

  let tracksProcessed = 0;
  let genresCreated = 0;
  let linksCreated = 0;

  const genreCache = new Map<string, string>();

  while (tracksProcessed < totalTracks) {
    const tracks = await client.$queryRaw<Array<{ id: string; genre: string }>>`
      SELECT id, genre FROM Track
      WHERE genre IS NOT NULL AND trim(genre) != ''
      LIMIT ${batchSize} OFFSET ${tracksProcessed}
    `;

    if (tracks.length === 0) break;

    for (const track of tracks) {
      const genreNames = parseGenreString(track.genre);

      for (const genreName of genreNames) {
        const normalizedName = normalizeGenreName(genreName);

        let genreId = genreCache.get(normalizedName);

        if (!genreId) {
          const existingGenre = await client.genre.findFirst({
            where: { normalizedName },
            select: { id: true },
          });

          if (existingGenre) {
            genreId = existingGenre.id;
          } else {
            const newGenre = await client.genre.create({
              data: {
                name: genreName,
                normalizedName,
              },
              select: { id: true },
            });
            genreId = newGenre.id;
            genresCreated++;
          }

          genreCache.set(normalizedName, genreId);
        }

        const linkResult = await client.$executeRaw`
          INSERT OR IGNORE INTO _TrackGenres (A, B) VALUES (${genreId}, ${track.id})
        `;
        if (linkResult > 0) {
          linksCreated++;
        }
      }
    }

    tracksProcessed += tracks.length;
    onProgress?.(tracksProcessed, totalTracks);
  }

  return { tracksProcessed, genresCreated, linksCreated };
}
