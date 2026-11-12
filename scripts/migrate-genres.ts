#!/usr/bin/env tsx
/**
 * Backfill `_TrackGenres` from legacy `Track.genre` (idempotent). No-op after ADR-037 column drop.
 */

import "dotenv/config";
import { migrateTrackGenres, trackGenreColumnExists } from "../app/utils/genre-migration.server.ts";

async function main() {
  if (!(await trackGenreColumnExists())) {
    console.log("Track.genre column is not present — nothing to migrate.");
    return;
  }

  const result = await migrateTrackGenres({
    batchSize: 100,
    onProgress: (current, total) => {
      const percent = total > 0 ? Math.round((current / total) * 100) : 100;
      console.log(`Progress: ${current}/${total} tracks (${percent}%)`);
    },
  });

  console.log("\n✅ Migration complete!");
  console.log(`   Tracks processed: ${result.tracksProcessed}`);
  console.log(`   Genres created: ${result.genresCreated}`);
  console.log(`   Links created: ${result.linksCreated}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
