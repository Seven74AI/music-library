#!/usr/bin/env tsx
// @context7: Prisma, Node.js fs, crypto, fpcalc
/**
 * Backfill contentHash and audioFingerprint for existing TrackAudioFile records
 *
 * This script:
 * 1. Finds all TrackAudioFile records with null contentHash or audioFingerprint
 * 2. Downloads each audio file from S3 (or local storage)
 * 3. Calculates SHA-256 hash and Chromaprint fingerprint
 * 4. Updates the database
 *
 * Run with: npx tsx prisma/backfill-audio-hashes.ts
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  calculateAudioHash,
  generateAudioFingerprint,
} from "#app/utils/audio-file-management.server";
import { downloadFile } from "#app/utils/storage.server";
import { prisma } from "#app/utils/db.server";

async function getAudioBuffer(objectKey: string): Promise<Buffer | null> {
  // Try local storage first (tests/fixtures/uploaded/)
  const localPath = join(process.cwd(), "tests", "fixtures", "uploaded", objectKey);

  if (existsSync(localPath)) {
    try {
      const buffer = readFileSync(localPath);
      console.log(`  ✓ Read from local: ${localPath}`);
      return buffer;
    } catch (error) {
      console.warn(
        `  ⚠️  Failed to read local file: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // Try S3/Tigris storage
  try {
    console.log(`  🌐 Downloading from S3: ${objectKey}`);
    const buffer = await downloadFile(objectKey);
    if (buffer) {
      console.log(`  ✓ Downloaded from S3 (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
      return buffer;
    }
  } catch (error) {
    console.warn(
      `  ⚠️  Failed to download from S3: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  console.warn(`  ❌ File not found in local storage or S3: ${objectKey}`);
  return null;
}

async function backfillContentHashes(dryRun = false): Promise<void> {
  console.log("🔍 Finding TrackAudioFile records without contentHash or audioFingerprint...\n");

  const audioFilesWithoutHash = await prisma.trackAudioFile.findMany({
    where: {
      OR: [{ contentHash: null }, { audioFingerprint: null }],
    },
    select: {
      id: true,
      objectKey: true,
      fileName: true,
      contentHash: true,
      audioFingerprint: true,
    },
  });

  if (audioFilesWithoutHash.length === 0) {
    console.log("✅ All audio files already have contentHash and audioFingerprint!\n");
    return;
  }

  console.log(`Found ${audioFilesWithoutHash.length} audio files to process\n`);

  if (dryRun) {
    console.log("🏃 DRY RUN MODE - No changes will be made\n");
  }

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const [index, audioFile] of audioFilesWithoutHash.entries()) {
    const progress = `[${index + 1}/${audioFilesWithoutHash.length}]`;
    console.log(`${progress} Processing: ${audioFile.fileName || audioFile.objectKey}`);

    const needsHash = !audioFile.contentHash;
    const needsFingerprint = !audioFile.audioFingerprint;

    if (needsHash) console.log(`  🔨 Needs hash`);
    if (needsFingerprint) console.log(`  🎵 Needs fingerprint`);

    try {
      // Get the audio file buffer
      const buffer = await getAudioBuffer(audioFile.objectKey);

      if (!buffer) {
        skipCount++;
        console.log(`  ⏭️  Skipped (file not accessible)\n`);
        continue;
      }

      const updates: { contentHash?: string; audioFingerprint?: string | null } = {};

      // Calculate hash if needed
      if (needsHash) {
        const contentHash = await calculateAudioHash(buffer);
        console.log(`  📊 Hash: ${contentHash.substring(0, 16)}...`);
        updates.contentHash = contentHash;
      }

      // Generate fingerprint if needed
      if (needsFingerprint) {
        const audioFingerprint = await generateAudioFingerprint(buffer);
        if (audioFingerprint) {
          console.log(`  🎵 Fingerprint: ${audioFingerprint.substring(0, 16)}...`);
          updates.audioFingerprint = audioFingerprint;
        } else {
          console.warn(`  ⚠️  Could not generate fingerprint`);
          updates.audioFingerprint = null;
        }
      }

      if (!dryRun) {
        // Update database
        await prisma.trackAudioFile.update({
          where: { id: audioFile.id },
          data: updates,
        });
        console.log(`  ✅ Updated in database\n`);
      } else {
        console.log(`  ℹ️  Would update in database (dry run)\n`);
      }

      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    }
  }

  // Summary
  console.log("═".repeat(60));
  console.log("📊 Summary:");
  console.log(`   ✅ Successfully hashed: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   📝 Total processed: ${audioFilesWithoutHash.length}`);
  console.log("═".repeat(60) + "\n");

  // Check for duplicates
  if (!dryRun && successCount > 0) {
    console.log("🔍 Checking for newly discovered duplicates...\n");

    const duplicates = await prisma.$queryRaw<Array<{ contentHash: string; count: bigint }>>`
      SELECT contentHash, COUNT(*) as count
      FROM TrackAudioFile
      WHERE contentHash IS NOT NULL
      GROUP BY contentHash
      HAVING COUNT(*) > 1
    `;

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate audio hashes:`);
      for (const dup of duplicates) {
        const count = Number(dup.count);
        const files = await prisma.trackAudioFile.findMany({
          where: { contentHash: dup.contentHash },
          include: {
            track: {
              select: {
                title: true,
                artist: { select: { name: true } },
              },
            },
          },
        });

        console.log(`\n  Hash: ${dup.contentHash.substring(0, 16)}... (${count} files)`);
        files.forEach((file: any, i: number) => {
          console.log(
            `    ${i + 1}. "${file.track.title}" by ${file.track.artist.name} (${file.fileName})`,
          );
        });
      }

      console.log(
        "\n💡 Consider consolidating these duplicates to save storage.\n" +
          "   See docs/audio-deduplication.md for cleanup strategies.\n",
      );
    } else {
      console.log("✅ No duplicates found!\n");
    }
  }
}

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("-d");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Backfill contentHash and audioFingerprint for existing TrackAudioFile records

Usage:
  npx tsx prisma/backfill-audio-hashes.ts [options]

Options:
  --dry-run, -d    Preview changes without updating database
  --help, -h       Show this help message

Examples:
  npx tsx prisma/backfill-audio-hashes.ts --dry-run
  npx tsx prisma/backfill-audio-hashes.ts
`);
  process.exit(0);
}

// Run the backfill
backfillContentHashes(dryRun)
  .then(() => {
    console.log("✅ Backfill complete!\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    // Prisma disconnect is handled by the imported prisma instance
  });
