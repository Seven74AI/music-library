import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { persistTrackAudio } from "#app/features/track-audio-ingest/persist-track-audio.server.ts";
import { extractAudioMetadata } from "#app/utils/audio-metadata.server";
import { prisma } from "#app/utils/db.server.ts";
import { checkPlaylistArchiveReadyAfterTrackArchived } from "#app/utils/playlist-archive-ready.server.tsx";
import {
  recordArchiveSuccess,
  recordCookieExpiredFailure,
  isCookieExpiredFailure,
  COOKIE_FAILURE_PAUSE_THRESHOLD,
} from "./cookie-failure-streak.ts";
import {
  notifyCookieExpired,
  notifyJobFailed,
  notifyWorkerPausedForCookies,
} from "./notification.server";
import { isWorkerActive, pauseWorker } from "./worker-control.server";
import { getCookieFilePath } from "./youtube-cookie.server";
import {
  executeYtDlp,
  ErrorCategory,
  isAllowedArchiveDownloadUrl,
  resolveContainedOutputPath,
  type ErrorCategory as ErrorCategoryType,
} from "./yt-dlp.server";

/**
 * Maximum number of retry attempts for retriable errors.
 * A job fails permanently only after this many retries have been exhausted
 * (initial attempt + MAX_RETRIES retries), per Decision #5.
 */
const MAX_RETRIES = 3;

/**
 * Exponential backoff between retries (Decision #5): 1st retry after 5 min,
 * 2nd after 30 min, 3rd after 2 h. Indexed by the post-increment retryCount.
 */
const RETRY_BACKOFF_MS: ReadonlyArray<number> = [
  5 * 60_000, // retry #1 → 5 min
  30 * 60_000, // retry #2 → 30 min
  2 * 60 * 60_000, // retry #3 → 2 h
];

function retryBackoffMs(retryCount: number): number {
  return RETRY_BACKOFF_MS[retryCount - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!;
}

/** Default stale threshold: 2× yt-dlp timeout (5 min each). */
const DEFAULT_STALE_JOB_MS = 600_000;

let queueTickInFlight = false;

const ENQUEUE_WAKE_DEBOUNCE_MS = 500;
let enqueueWakeTimer: ReturnType<typeof setTimeout> | null = null;

/** In-memory set of job IDs currently being processed. Avoids DB writes per job. */
const currentlyProcessingSet = new Set<string>();

/** Exported for admin UI — returns all job IDs currently being processed. */
export function getCurrentlyProcessingJobs(): string[] {
  return [...currentlyProcessingSet];
}

/**
 * Wake the archive worker soon after new jobs are enqueued.
 * Debounced so bulk imports schedule one tick instead of one per track.
 */
export function scheduleQueueTick(): void {
  if (process.env.AUDIO_ARCHIVE_ENABLED !== "true") return;
  if (enqueueWakeTimer) clearTimeout(enqueueWakeTimer);
  enqueueWakeTimer = setTimeout(() => {
    enqueueWakeTimer = null;
    void processQueueTick();
  }, ENQUEUE_WAKE_DEBOUNCE_MS);
}

function getStaleJobThresholdMs(): number {
  const parsed = Number.parseInt(
    process.env.AUDIO_ARCHIVE_STALE_JOB_MS ?? String(DEFAULT_STALE_JOB_MS),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_JOB_MS;
}

/**
 * Reset archive jobs left in `processing` after a crash, deploy, or hung step.
 * Without this, orphaned jobs fill all concurrency slots and the queue stalls.
 */
export async function recoverStaleProcessingJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - getStaleJobThresholdMs());

  const staleJobs = await prisma.archiveJob.findMany({
    where: {
      status: "processing",
      OR: [{ lastAttemptAt: { lt: cutoff } }, { lastAttemptAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true },
  });

  if (staleJobs.length === 0) return 0;

  for (const job of staleJobs) {
    await handleJobError(
      job.id,
      ErrorCategory.UNKNOWN,
      "Processing timed out (worker recovered stale job)",
      "",
    );
  }

  await prisma.workerState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", status: "running" },
  });

  console.warn(`Recovered ${staleJobs.length} stale archive job(s)`);
  return staleJobs.length;
}

/**
 * Error categories that should NOT be retried.
 * These are permanent failures (auth, geo, video removed, cookies).
 */
const NON_RETRIABLE_ERRORS: ErrorCategoryType[] = [
  ErrorCategory.AUTH,
  ErrorCategory.GEO_BLOCKED,
  ErrorCategory.VIDEO_UNAVAILABLE,
  ErrorCategory.COOKIE_EXPIRED,
  ErrorCategory.FILE_NOT_FOUND,
  // "Requested format is not available" is a permanent condition for that
  // video — auto-retry only re-spawns yt-dlp to fail the same way. Manual
  // re-enqueue (after fixing yt-dlp format selection) is the only recovery,
  // which is what `recoverable-failure.ts` models.
  ErrorCategory.FORMAT_UNAVAILABLE,
];

function categorizeJobError(error: unknown): ErrorCategoryType {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return ErrorCategory.FILE_NOT_FOUND;
  }
  return ErrorCategory.UNKNOWN;
}

/**
 * Process a single tick of the archive queue.
 *
 * 1. Checks if the worker is active (not paused, not on break)
 * 2. Checks if AUDIO_ARCHIVE_ENABLED is true
 * 3. Picks pending jobs ordered by priority then creation date
 * 4. Respects max concurrent limit
 * 5. Downloads audio via yt-dlp, uploads to Tigris
 * 6. Creates TrackAudioFile record on success
 * 7. Updates ArchiveJob status and error history on failure
 */
export async function processQueueTick(): Promise<void> {
  if (process.env.AUDIO_ARCHIVE_ENABLED !== "true") return;
  if (queueTickInFlight) return;

  queueTickInFlight = true;
  try {
    await processQueueTickInner();
  } catch (error) {
    // A transient DB/yt-dlp failure must not become an unhandled rejection
    // and crash the process — log it and let the next tick retry.
    console.error("processQueueTick failed:", error);
  } finally {
    queueTickInFlight = false;
  }
}

async function processQueueTickInner(): Promise<void> {
  const active = await isWorkerActive();
  if (!active) return;

  const maxConcurrent = Number.parseInt(process.env.AUDIO_ARCHIVE_MAX_CONCURRENT ?? "2", 10);

  const cookieFile = getCookieFilePath();

  while (true) {
    const stillActive = await isWorkerActive();
    if (!stillActive) break;

    await recoverStaleProcessingJobs();

    const processingCount = await prisma.archiveJob.count({
      where: { status: "processing" },
    });

    const available = maxConcurrent - processingCount;
    if (available <= 0) break;

    const jobs = await prisma.archiveJob.findMany({
      where: {
        status: "pending",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: available,
      include: {
        track: {
          select: {
            id: true,
            serviceUrl: true,
            service: { select: { name: true } },
          },
        },
      },
    });

    if (jobs.length === 0) break;

    await Promise.all(
      jobs.map((job) =>
        processJob(
          job.id,
          job.track.id,
          job.track.service.name,
          job.track.serviceUrl ?? "",
          cookieFile,
        ),
      ),
    );
  }

  // Update last queue run timestamp
  await prisma.workerState.upsert({
    where: { id: "singleton" },
    update: { lastQueueRun: new Date() },
    create: { id: "singleton", status: "running" },
  });
}

/**
 * Process a single archive job.
 */
async function processJob(
  jobId: string,
  trackId: string,
  serviceName: string,
  url: string,
  cookieFile?: string,
): Promise<void> {
  // Atomically claim the job. A conditional updateMany is a single SQL
  // statement, so two instances racing on the same pending job can't both
  // claim it — one gets count 0 and skips (no duplicate download/upload).
  const claim = await prisma.archiveJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: {
      status: "processing",
      lastAttemptAt: new Date(),
    },
  });

  if (claim.count === 0) {
    // Another worker instance already claimed this job.
    return;
  }

  // Track in memory — avoids extra DB write per job
  currentlyProcessingSet.add(jobId);

  try {
    const outputDir = os.tmpdir();

    if (!isAllowedArchiveDownloadUrl(url)) {
      await handleJobError(
        jobId,
        ErrorCategory.UNKNOWN,
        "Refusing to download a URL that is not an allowed YouTube watch URL",
        url,
      );
      return;
    }

    // 1. Download via yt-dlp
    const result = await executeYtDlp(url, { cookieFile, outputDir });

    if (result.exitCode !== 0 || !result.filePath) {
      const missingContainedFile = result.exitCode === 0 && !result.filePath;
      await handleJobError(
        jobId,
        missingContainedFile ? ErrorCategory.FILE_NOT_FOUND : (result.errorCategory ?? "UNKNOWN"),
        result.errorMessage ??
          (missingContainedFile
            ? "Refusing to read a download path outside the output directory"
            : null),
        url,
      );
      return;
    }

    const containedPath = resolveContainedOutputPath(result.filePath, outputDir);
    if (!containedPath) {
      await handleJobError(
        jobId,
        ErrorCategory.FILE_NOT_FOUND,
        "Refusing to read a download path outside the output directory",
        url,
      );
      return;
    }

    // 2. Persist audio: upload → TrackAudioFile → best-effort metadata backfill
    const audioBuffer = readFileSync(containedPath);
    const extractedMetadata = await extractAudioMetadata(audioBuffer, containedPath);
    const extension = path.extname(containedPath).slice(1) || extractedMetadata.format || "mp3";

    await persistTrackAudio({
      trackId,
      serviceName,
      buffer: audioBuffer,
      metadata: extractedMetadata,
      extension,
    });

    // 3. Mark job as completed
    await prisma.archiveJob.update({
      where: { id: jobId },
      data: { status: "completed" },
    });

    recordArchiveSuccess();

    void checkPlaylistArchiveReadyAfterTrackArchived(trackId, process.env.SITE_URL).catch(
      (error) => {
        console.error(`Failed to check playlist archive readiness for track ${trackId}:`, error);
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await handleJobError(jobId, categorizeJobError(error), message, url);
  } finally {
    currentlyProcessingSet.delete(jobId);
  }
}

/**
 * Handle a job error: categorize, record in error history, and
 * either mark as failed (non-retriable) or reset to pending for retry.
 *
 * Side effects:
 * - Invalidates YoutubeCookie records on AUTH/COOKIE_EXPIRED errors
 * - Sends Telegram notification for permanent failures
 */
async function handleJobError(
  jobId: string,
  category: ErrorCategoryType,
  message: string | null,
  trackUrl: string,
): Promise<void> {
  const job = await prisma.archiveJob.findUnique({
    where: { id: jobId },
    select: { retryCount: true, errorHistory: true },
  });

  if (!job) return;

  const errorEntry = {
    category,
    message: message ?? "Unknown error",
    timestamp: new Date().toISOString(),
  };

  let errorHistory: unknown[];
  try {
    errorHistory = JSON.parse(job.errorHistory) as unknown[];
  } catch {
    errorHistory = [];
  }
  errorHistory.push(errorEntry);

  const newRetryCount = job.retryCount + 1;
  const isNonRetriable = NON_RETRIABLE_ERRORS.includes(category);
  // Fail only after all retries are exhausted (Decision #5): the 3rd retry
  // (newRetryCount === MAX_RETRIES) still gets a 2 h backoff.
  const shouldFail = isNonRetriable || newRetryCount > MAX_RETRIES;

  // Only retriable failures get a scheduled next attempt (Decision #5).
  const nextAttemptAt = shouldFail ? null : new Date(Date.now() + retryBackoffMs(newRetryCount));

  await prisma.archiveJob.update({
    where: { id: jobId },
    data: {
      status: shouldFail ? "failed" : "pending",
      retryCount: newRetryCount,
      nextAttemptAt,
      errorHistory: JSON.stringify(errorHistory),
    },
  });

  // Cookie-related errors: flag all cookies as invalid + notify admin
  if (category === ErrorCategory.AUTH || category === ErrorCategory.COOKIE_EXPIRED) {
    await prisma.youtubeCookie.updateMany({
      where: { valid: true },
      data: { valid: false, updatedAt: new Date() },
    });

    void notifyCookieExpired(jobId, trackUrl, message ?? "Unknown error");

    if (isCookieExpiredFailure(category)) {
      const shouldPause = recordCookieExpiredFailure();
      if (shouldPause) {
        await pauseWorker();
        void notifyWorkerPausedForCookies(COOKIE_FAILURE_PAUSE_THRESHOLD);
      }
    }
  }

  // Notify on other permanent failures (fire-and-forget)
  if (shouldFail && category !== ErrorCategory.AUTH && category !== ErrorCategory.COOKIE_EXPIRED) {
    void notifyJobFailed(jobId, trackUrl, category, message ?? "Unknown error");
  }
}

export { resetCookieFailureStreak } from "./cookie-failure-streak.ts";

/**
 * Reset archive jobs whose latest error is an auth/cookie failure back to
 * `pending` with a zeroed retry count. Called when an admin uploads fresh
 * YouTube cookies (CONTEXT.md decision #10 — "Cookie refresh auto-reset").
 * Jobs with other (non-auth) errors are left alone.
 */
export async function resetAuthFailedJobs(): Promise<number> {
  const authCategories: ErrorCategoryType[] = [ErrorCategory.AUTH, ErrorCategory.COOKIE_EXPIRED];

  const failedJobs = await prisma.archiveJob.findMany({
    where: { status: "failed" },
    select: { id: true, errorHistory: true },
  });

  const resetIds: string[] = [];
  for (const job of failedJobs) {
    try {
      const errors = JSON.parse(job.errorHistory) as Array<{ category?: string }>;
      const latest = errors[errors.length - 1];
      if (latest && authCategories.includes(latest.category as ErrorCategoryType)) {
        resetIds.push(job.id);
      }
    } catch {
      // Unparseable history — leave the job alone.
    }
  }

  if (resetIds.length === 0) return 0;

  await prisma.archiveJob.updateMany({
    where: { id: { in: resetIds } },
    data: { status: "pending", retryCount: 0 },
  });

  return resetIds.length;
}

/**
 * Get the current queue stats for monitoring.
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const groups = await prisma.archiveJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));

  return {
    pending: byStatus["pending"] ?? 0,
    processing: byStatus["processing"] ?? 0,
    completed: byStatus["completed"] ?? 0,
    failed: byStatus["failed"] ?? 0,
  };
}
