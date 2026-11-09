import { getInstanceInfo } from "./litefs.server.ts";
import { runDuplicateDetectionJob } from "./duplicate-detection-job.server.ts";

/** Poll once a minute; the job itself runs at most once per UTC day. */
export const DUPLICATE_DETECTION_TICK_INTERVAL_MS = 60 * 1000;
/** Daily run window opens at 02:00 UTC (ADR-034). */
export const DUPLICATE_DETECTION_HOUR_UTC = 2;
export const DUPLICATE_DETECTION_RETRY_DELAY_MS = 15 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastSuccessDay: string | null = null;
let nextRetryAt: number | null = null;
let inFlight = false;

export function resetDuplicateDetectionSchedulerForTests(): void {
  lastSuccessDay = null;
  nextRetryAt = null;
  inFlight = false;
}

export function stopDuplicateDetectionScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export async function processDuplicateDetectionTick(options?: {
  now?: Date;
  skipPrimaryCheck?: boolean;
  run?: typeof runDuplicateDetectionJob;
}): Promise<void> {
  if (inFlight) return;

  const now = options?.now ?? new Date();
  if (now.getUTCHours() < DUPLICATE_DETECTION_HOUR_UTC) return;

  const day = now.toISOString().slice(0, 10);
  if (lastSuccessDay === day) return;
  if (nextRetryAt !== null && now.getTime() < nextRetryAt) return;

  inFlight = true;
  try {
    if (!options?.skipPrimaryCheck) {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
    }

    const run = options?.run ?? runDuplicateDetectionJob;
    const result = await run();
    if (result.success) {
      lastSuccessDay = day;
      nextRetryAt = null;
      return;
    }

    nextRetryAt = now.getTime() + DUPLICATE_DETECTION_RETRY_DELAY_MS;
  } catch (error) {
    nextRetryAt = now.getTime() + DUPLICATE_DETECTION_RETRY_DELAY_MS;
    console.error("Duplicate detection tick failed", error);
  } finally {
    inFlight = false;
  }
}

export function scheduleDuplicateDetection(): void {
  if (intervalHandle !== null) return;

  const runTick = () => {
    void processDuplicateDetectionTick();
  };

  void runTick();
  intervalHandle = setInterval(runTick, DUPLICATE_DETECTION_TICK_INTERVAL_MS);
  console.log(
    `Duplicate detection scheduler started (hour UTC: ${DUPLICATE_DETECTION_HOUR_UTC}, tick: ${DUPLICATE_DETECTION_TICK_INTERVAL_MS}ms)`,
  );
}
