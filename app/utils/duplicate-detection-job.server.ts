/**
 * Duplicate Detection Job
 * Runs the duplicate detection algorithm and caches results
 * ADR-034: Duplicate Detection Algorithm
 *
 * This job should be run:
 * - Weekly via cron (Sunday at 3 AM)
 * - Manually via admin trigger
 * - On-demand when needed
 */

import {
  findExactArtistDuplicates,
  findFuzzyArtistDuplicates,
  findExactAlbumDuplicates,
  findFuzzyAlbumDuplicates,
  cacheArtistNormalizedNames,
  cacheAlbumNormalizedNames,
  saveDuplicateDetectionResults,
} from "./duplicate-detection.server.ts";

export interface DuplicateDetectionJobResult {
  success: boolean;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  artistsProcessed: number;
  albumsProcessed: number;
  exactArtistGroups: number;
  fuzzyArtistGroups: number;
  exactAlbumGroups: number;
  fuzzyAlbumGroups: number;
  error?: string;
}

/**
 * Run the duplicate detection job
 * This function:
 * 1. Caches normalized names for all artists and albums
 * 2. Runs exact and fuzzy duplicate detection for artists
 * 3. Runs exact and fuzzy duplicate detection for albums
 * 4. Saves results to the database
 */
export async function runDuplicateDetectionJob(): Promise<DuplicateDetectionJobResult> {
  const startedAt = new Date();

  try {
    console.log("🔍 Starting duplicate detection job...");

    // Step 1: Cache normalized names
    console.log("📝 Caching normalized names...");
    await cacheArtistNormalizedNames();
    await cacheAlbumNormalizedNames();

    // Step 2: Detect artist duplicates
    console.log("🎵 Detecting artist duplicates...");
    const [exactArtistGroups, fuzzyArtistGroups] = await Promise.all([
      findExactArtistDuplicates(),
      findFuzzyArtistDuplicates(),
    ]);

    console.log(`   Found ${exactArtistGroups.length} exact artist groups`);
    console.log(`   Found ${fuzzyArtistGroups.length} fuzzy artist groups`);

    // Step 3: Detect album duplicates
    console.log("💿 Detecting album duplicates...");
    const [exactAlbumGroups, fuzzyAlbumGroups] = await Promise.all([
      findExactAlbumDuplicates(),
      findFuzzyAlbumDuplicates(),
    ]);

    console.log(`   Found ${exactAlbumGroups.length} exact album groups`);
    console.log(`   Found ${fuzzyAlbumGroups.length} fuzzy album groups`);

    // Step 4: Save results to database
    console.log("💾 Saving results to database...");
    await Promise.all([
      saveDuplicateDetectionResults("artist", exactArtistGroups, fuzzyArtistGroups),
      saveDuplicateDetectionResults("album", exactAlbumGroups, fuzzyAlbumGroups),
    ]);

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const result: DuplicateDetectionJobResult = {
      success: true,
      startedAt,
      completedAt,
      durationMs,
      artistsProcessed:
        exactArtistGroups.reduce((sum, g) => sum + g.artists.length, 0) +
        fuzzyArtistGroups.reduce((sum, g) => sum + g.artists.length, 0),
      albumsProcessed:
        exactAlbumGroups.reduce((sum, g) => sum + g.albums.length, 0) +
        fuzzyAlbumGroups.reduce((sum, g) => sum + g.albums.length, 0),
      exactArtistGroups: exactArtistGroups.length,
      fuzzyArtistGroups: fuzzyArtistGroups.length,
      exactAlbumGroups: exactAlbumGroups.length,
      fuzzyAlbumGroups: fuzzyAlbumGroups.length,
    };

    console.log(`✅ Duplicate detection completed in ${durationMs}ms`);
    console.log(
      `   Artists: ${result.exactArtistGroups} exact + ${result.fuzzyArtistGroups} fuzzy`,
    );
    console.log(`   Albums: ${result.exactAlbumGroups} exact + ${result.fuzzyAlbumGroups} fuzzy`);

    return result;
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    console.error("❌ Duplicate detection failed:", error);

    return {
      success: false,
      startedAt,
      completedAt,
      durationMs,
      artistsProcessed: 0,
      albumsProcessed: 0,
      exactArtistGroups: 0,
      fuzzyArtistGroups: 0,
      exactAlbumGroups: 0,
      fuzzyAlbumGroups: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
