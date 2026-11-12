/**
 * Legacy Track.genre → `_TrackGenres` backfill without the generated Prisma client.
 * Used by `npm run migrate:deploy` on fresh checkouts (CI, LiteFS) before `prisma migrate deploy`.
 */

import { createId } from "@paralleldrive/cuid2";
import { DatabaseSync } from "node:sqlite";
import { getDatabaseUrl } from "../app/utils/database-url.server.ts";
import {
  DROP_TRACK_GENRE_MIGRATION,
  migrateTrackGenresWithStore,
} from "../app/utils/genre-migration.shared.ts";

function sqliteFilePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    return databaseUrl.slice("file:".length);
  }
  return databaseUrl;
}

function trackGenreColumnExists(db: DatabaseSync): boolean {
  const columns = db.prepare(`PRAGMA table_info('Track')`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "genre");
}

function isDropTrackGenreMigrationPending(db: DatabaseSync): boolean {
  const rows = db
    .prepare(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`)
    .all() as Array<{ migration_name: string }>;
  return !rows.some((row) => row.migration_name === DROP_TRACK_GENRE_MIGRATION);
}

export async function backfillLegacyTrackGenresIfNeeded(databaseUrl = getDatabaseUrl()): Promise<{
  ran: boolean;
  result: { tracksProcessed: number; genresCreated: number; linksCreated: number };
}> {
  const dbPath = sqliteFilePath(databaseUrl);
  const db = new DatabaseSync(dbPath);

  try {
    if (!trackGenreColumnExists(db) || !isDropTrackGenreMigrationPending(db)) {
      return {
        ran: false,
        result: { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 },
      };
    }

    const result = await migrateTrackGenresWithStore({
      trackGenreColumnExists: () => trackGenreColumnExists(db),
      countTracksWithLegacyGenre: () => {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS count FROM Track WHERE genre IS NOT NULL AND trim(genre) != ''`,
          )
          .get() as { count: number };
        return row.count;
      },
      fetchTrackGenreBatch: (limit, offset) =>
        db
          .prepare(
            `SELECT id, genre FROM Track WHERE genre IS NOT NULL AND trim(genre) != '' LIMIT ? OFFSET ?`,
          )
          .all(limit, offset) as Array<{ id: string; genre: string }>,
      findGenreIdByNormalizedName: (normalizedName) => {
        const row = db
          .prepare(`SELECT id FROM Genre WHERE normalizedName = ?`)
          .get(normalizedName) as { id: string } | undefined;
        return row?.id;
      },
      createGenre: (name, normalizedName) => {
        const id = createId();
        db.prepare(
          `INSERT INTO Genre (id, name, normalizedName, createdAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).run(id, name, normalizedName);
        return id;
      },
      insertTrackGenreLink: (genreId, trackId) => {
        const info = db
          .prepare(`INSERT OR IGNORE INTO _TrackGenres (A, B) VALUES (?, ?)`)
          .run(genreId, trackId);
        return (info as { changes: number }).changes > 0;
      },
    });

    return { ran: true, result };
  } finally {
    db.close();
  }
}
