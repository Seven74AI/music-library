/**
 * Generate On-Repeat Snapshots for the previous calendar month (ADR-024).
 *
 * Intended to run on the 1st of each month (UTC). Idempotent per (userId, year-month).
 *
 * Usage:
 *   tsx scripts/generate-on-repeat-snapshots.ts
 *   tsx scripts/generate-on-repeat-snapshots.ts --year-month 2026-08
 *   tsx scripts/generate-on-repeat-snapshots.ts --force   # run even when today is not the 1st
 */
import "dotenv/config";
import { generateOnRepeatSnapshotsForMonth } from "#app/features/on-repeat-snapshots/generate.server.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const yearMonthFlag = args.indexOf("--year-month");
const yearMonth =
  yearMonthFlag >= 0 && args[yearMonthFlag + 1] ? args[yearMonthFlag + 1] : undefined;

async function main() {
  const now = new Date();
  if (!force && !yearMonth && now.getUTCDate() !== 1) {
    console.log(
      `Skipping: today is UTC day ${now.getUTCDate()} (run on the 1st, or pass --force / --year-month).`,
    );
    process.exit(0);
  }

  const summary = await generateOnRepeatSnapshotsForMonth({
    asOf: now,
    yearMonth,
  });

  console.log(
    `On-Repeat Snapshots for ${summary.yearMonth}: created=${summary.created} alreadyExists=${summary.alreadyExists} skippedEmpty=${summary.skippedEmpty}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
