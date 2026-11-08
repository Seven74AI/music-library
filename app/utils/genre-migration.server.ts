/**
 * Genre Migration Utility
 *
 * Parses and normalizes genre names for the multi-genre tagging system.
 */

import { type PrismaClient } from "#prisma/client.js";
import {
  DROP_TRACK_GENRE_MIGRATION,
  migrateTrackGenresWithStore,
  normalizeGenreName,
  parseGenreString,
} from "./genre-migration.shared.ts";
import { prisma } from "./db.server.ts";

export { normalizeGenreName, parseGenreString, DROP_TRACK_GENRE_MIGRATION };

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

  return migrateTrackGenresWithStore(
    {
      trackGenreColumnExists: () => true,
      countTracksWithLegacyGenre: async () => {
        const totalRow = await client.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM Track WHERE genre IS NOT NULL AND trim(genre) != ''
        `;
        return Number(totalRow[0]?.count ?? 0);
      },
      fetchTrackGenreBatch: async (limit, offset) =>
        client.$queryRaw<Array<{ id: string; genre: string }>>`
          SELECT id, genre FROM Track
          WHERE genre IS NOT NULL AND trim(genre) != ''
          LIMIT ${limit} OFFSET ${offset}
        `,
      findGenreIdByNormalizedName: async (normalizedName) => {
        const existingGenre = await client.genre.findFirst({
          where: { normalizedName },
          select: { id: true },
        });
        return existingGenre?.id;
      },
      createGenre: async (name, normalizedName) => {
        const newGenre = await client.genre.create({
          data: { name, normalizedName },
          select: { id: true },
        });
        return newGenre.id;
      },
      insertTrackGenreLink: async (genreId, trackId) => {
        const linkResult = await client.$executeRaw`
          INSERT OR IGNORE INTO _TrackGenres (A, B) VALUES (${genreId}, ${trackId})
        `;
        return linkResult > 0;
      },
    },
    { batchSize, onProgress },
  );
}
