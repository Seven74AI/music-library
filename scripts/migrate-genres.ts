#!/usr/bin/env tsx
/**
 * @deprecated `Track.genre` was removed in ADR-037. Genre data lives in `_TrackGenres`.
 */
import "dotenv/config";
import { migrateTrackGenres } from "../app/utils/genre-migration.server.ts";

async function main() {
  const result = await migrateTrackGenres();
  console.log("Legacy Track.genre migration is no longer applicable.");
  console.log(JSON.stringify(result));
}

main();
