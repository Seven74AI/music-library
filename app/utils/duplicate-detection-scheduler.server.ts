import { createDailyPrimaryScheduler } from "./daily-primary-scheduler.server.ts";
import { runDuplicateDetectionJob } from "./duplicate-detection-job.server.ts";

/** Poll once a minute; the job itself runs at most once per UTC day. */
export const DUPLICATE_DETECTION_TICK_INTERVAL_MS = 60 * 1000;
/** Daily run window opens at 02:00 UTC (ADR-034). */
export const DUPLICATE_DETECTION_HOUR_UTC = 2;
export const DUPLICATE_DETECTION_RETRY_DELAY_MS = 15 * 60 * 1000;

const scheduler = createDailyPrimaryScheduler({
  hourUtc: DUPLICATE_DETECTION_HOUR_UTC,
  retryDelayMs: DUPLICATE_DETECTION_RETRY_DELAY_MS,
  tickIntervalMs: DUPLICATE_DETECTION_TICK_INTERVAL_MS,
  logLabel: "Duplicate detection",
  tickFailedLogMessage: "Duplicate detection tick failed",
  defaultRun: runDuplicateDetectionJob,
});

export function resetDuplicateDetectionSchedulerForTests(): void {
  scheduler.resetForTests();
}

export function stopDuplicateDetectionScheduler(): void {
  scheduler.stop();
}

export async function processDuplicateDetectionTick(options?: {
  now?: Date;
  skipPrimaryCheck?: boolean;
  run?: typeof runDuplicateDetectionJob;
}): Promise<void> {
  return scheduler.processTick(options);
}

export function scheduleDuplicateDetection(): void {
  scheduler.schedule();
}
