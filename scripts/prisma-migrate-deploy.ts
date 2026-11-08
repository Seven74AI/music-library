#!/usr/bin/env tsx
/**
 * Applies Prisma migrations, running the legacy Track.genre TypeScript backfill
 * immediately before `20261108160000_drop_track_genre` when that migration is pending.
 */

import "dotenv/config";
import { execSync } from "node:child_process";

async function main() {
  // CI and fresh checkouts run migrate before `prisma generate --sql`; the backfill needs the client.
  execSync("npx prisma generate", { stdio: "inherit", env: process.env });

  const { backfillLegacyTrackGenresIfNeeded } =
    await import("../app/utils/genre-migration.server.ts");
  const { ran, result } = await backfillLegacyTrackGenresIfNeeded();
  if (ran) {
    console.log(
      `Legacy Track.genre backfill: ${result.tracksProcessed} tracks, ${result.genresCreated} genres created, ${result.linksCreated} links added`,
    );
  }

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
