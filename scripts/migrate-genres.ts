#!/usr/bin/env tsx
/**
 * @deprecated Prefer `npx tsx prisma/backfill-track-genre-m2m.ts`.
 */
import "dotenv/config";
import { migrateTrackGenres } from "../app/utils/genre-migration.server.ts";

async function main() {
  console.log("Starting genre migration...\n");

  try {
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
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

main();
