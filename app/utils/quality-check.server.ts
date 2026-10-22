import { prisma } from "./db.server.ts";
import { getInstanceInfo } from "./litefs.server.ts";

interface QualityIssue {
  trackId: string;
  issueType: string;
  description: string;
  priority: number;
}

/**
 * Quality check job that detects data quality issues in tracks
 * Should be run daily at 2 AM
 */
export async function runQualityCheck() {
  console.log("Starting quality check job...");

  const issues: QualityIssue[] = [];

  try {
    // Get all tracks with potential issues
    const tracks = await prisma.track.findMany({
      select: {
        id: true,
        title: true,
        artistId: true,
        albumId: true,
        genre: true,
        duration: true,
        coverImage: {
          select: {
            width: true,
            height: true,
          },
        },
      },
    });

    for (const track of tracks) {
      // Check for missing artist (should not happen due to schema, but check anyway)
      if (!track.artistId) {
        issues.push({
          trackId: track.id,
          issueType: "missing_info",
          description: "Track is missing artist information",
          priority: 3,
        });
      }

      // Check for missing album
      if (!track.albumId) {
        issues.push({
          trackId: track.id,
          issueType: "missing_info",
          description: "Track is missing album information",
          priority: 2,
        });
      }

      // Check for missing genre
      if (!track.genre || track.genre.trim() === "") {
        issues.push({
          trackId: track.id,
          issueType: "missing_info",
          description: "Track is missing genre information",
          priority: 2,
        });
      }

      // Check for low-resolution cover image
      if (track.coverImage) {
        const width = track.coverImage.width || 0;
        const height = track.coverImage.height || 0;
        if (width > 0 && width < 300) {
          issues.push({
            trackId: track.id,
            issueType: "low_quality",
            description: `Cover image resolution is too low (${width}x${height}px, minimum 300x300px)`,
            priority: 1,
          });
        }
      }

      // Check for zero duration
      if (track.duration !== null && track.duration === 0) {
        issues.push({
          trackId: track.id,
          issueType: "missing_info",
          description: "Track has zero duration",
          priority: 2,
        });
      }
    }

    console.log(`Found ${issues.length} quality issues`);

    // Create queue items for issues (avoid duplicates)
    if (issues.length > 0) {
      const createdCount = await createQueueItems(issues);
      console.log(`Created ${createdCount} new queue items`);
    }

    return {
      success: true,
      tracksChecked: tracks.length,
      issuesFound: issues.length,
    };
  } catch (error) {
    console.error("Error running quality check:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function createQueueItems(issues: QualityIssue[]): Promise<number> {
  let createdCount = 0;

  // Process in batches to avoid overwhelming the database
  const batchSize = 100;
  for (let i = 0; i < issues.length; i += batchSize) {
    const batch = issues.slice(i, i + batchSize);

    // Check which issues don't already exist in the queue
    const existingItems = await prisma.reviewQueueItem.findMany({
      where: {
        entityType: "track",
        entityId: { in: batch.map((issue) => issue.trackId) },
        source: "system",
        status: { in: ["open", "claimed"] },
      },
      select: {
        entityId: true,
        issueType: true,
      },
    });

    const existingKeys = new Set(existingItems.map((item) => `${item.entityId}-${item.issueType}`));

    // Filter out issues that already exist
    const newIssues = batch.filter(
      (issue) => !existingKeys.has(`${issue.trackId}-${issue.issueType}`),
    );

    if (newIssues.length > 0) {
      // Batch insert new queue items
      await prisma.reviewQueueItem.createMany({
        data: newIssues.map((issue) => ({
          entityType: "track",
          entityId: issue.trackId,
          source: "system",
          issueType: issue.issueType,
          description: issue.description,
          status: "open",
          priority: issue.priority,
        })),
      });

      createdCount += newIssues.length;
    }
  }

  return createdCount;
}

/** Poll once a minute; the check itself runs at most once per UTC day. */
export const QUALITY_CHECK_TICK_INTERVAL_MS = 60 * 1000;
/** Daily run window opens at 02:00 UTC. */
export const QUALITY_CHECK_HOUR_UTC = 2;
/** Space out retries so a failing scan is not repeated on every tick. */
export const QUALITY_CHECK_RETRY_DELAY_MS = 15 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastSuccessDay: string | null = null;
let nextRetryAt: number | null = null;
let inFlight = false;

export function resetQualityCheckSchedulerForTests(): void {
  lastSuccessDay = null;
  nextRetryAt = null;
  inFlight = false;
}

export function stopQualityCheckScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * One scheduler tick. Runs the quality check on the LiteFS primary once the UTC
 * hour reaches {@link QUALITY_CHECK_HOUR_UTC}, and not again until the next UTC day.
 */
export async function processQualityCheckTick(options?: {
  now?: Date;
  skipPrimaryCheck?: boolean;
  run?: typeof runQualityCheck;
}): Promise<void> {
  if (inFlight) return;

  const now = options?.now ?? new Date();
  if (now.getUTCHours() < QUALITY_CHECK_HOUR_UTC) return;

  const day = now.toISOString().slice(0, 10);
  if (lastSuccessDay === day) return;
  if (nextRetryAt !== null && now.getTime() < nextRetryAt) return;

  inFlight = true;
  try {
    if (!options?.skipPrimaryCheck) {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
    }

    const run = options?.run ?? runQualityCheck;
    const result = await run();
    if (result.success) {
      lastSuccessDay = day;
      nextRetryAt = null;
      return;
    }

    nextRetryAt = now.getTime() + QUALITY_CHECK_RETRY_DELAY_MS;
  } catch (error) {
    nextRetryAt = now.getTime() + QUALITY_CHECK_RETRY_DELAY_MS;
    console.error("Quality check tick failed", error);
  } finally {
    inFlight = false;
  }
}

/**
 * Start the in-process quality check on the same lifecycle as the other
 * background jobs. Idempotent: a second call does not register another interval.
 */
export function scheduleQualityCheck(): void {
  if (intervalHandle !== null) return;

  const runTick = () => {
    void processQualityCheckTick();
  };

  void runTick();
  intervalHandle = setInterval(runTick, QUALITY_CHECK_TICK_INTERVAL_MS);
  console.log(
    `Quality check scheduler started (hour UTC: ${QUALITY_CHECK_HOUR_UTC}, tick: ${QUALITY_CHECK_TICK_INTERVAL_MS}ms)`,
  );
}
