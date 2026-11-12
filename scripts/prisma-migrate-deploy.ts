#!/usr/bin/env tsx
/**
 * Applies Prisma migrations, running the legacy Track.genre backfill
 * immediately before `20261108160000_drop_track_genre` when that migration is pending.
 *
 * The backfill uses node:sqlite only — safe on fresh checkouts before `prisma generate`.
 */

import "dotenv/config";
import { execSync } from "node:child_process";
import { backfillLegacyTrackGenresIfNeeded } from "./legacy-track-genre-backfill.ts";

export async function runPrismaMigrateDeploy(exec: typeof execSync = execSync): Promise<void> {
  const { ran, result } = await backfillLegacyTrackGenresIfNeeded();
  if (ran) {
    console.log(
      `Legacy Track.genre backfill: ${result.tracksProcessed} tracks, ${result.genresCreated} genres created, ${result.linksCreated} links added`,
    );
  }

  exec("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}

async function main() {
  await runPrismaMigrateDeploy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
