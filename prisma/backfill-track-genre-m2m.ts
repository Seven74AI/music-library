#!/usr/bin/env tsx
/**
 * Backfill _TrackGenres from legacy Track.genre (run before drop_track_genre if needed).
 *
 *   npx tsx prisma/backfill-track-genre-m2m.ts
 */
import "dotenv/config";
import { migrateTrackGenres } from "../app/utils/genre-migration.server.ts";

async function main() {
  const result = await migrateTrackGenres({
    batchSize: 100,
    onProgress: (current, total) => {
      const percent = total > 0 ? Math.round((current / total) * 100) : 100;
      console.log(`Progress: ${current}/${total} tracks (${percent}%)`);
    },
  });

  console.log("\n✅ Backfill complete");
  console.log(`   Tracks processed: ${result.tracksProcessed}`);
  console.log(`   Genres created: ${result.genresCreated}`);
  console.log(`   Links created: ${result.linksCreated}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
