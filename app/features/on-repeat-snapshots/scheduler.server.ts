import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { generateOnRepeatSnapshotsForMonth } from "./generate.server.ts";

/** Poll once a minute; generation runs on the 1st at or after 02:00 UTC (ADR-024). */
export const ON_REPEAT_SNAPSHOT_TICK_INTERVAL_MS = 60 * 1000;
export const ON_REPEAT_SNAPSHOT_HOUR_UTC = 2;
export const ON_REPEAT_SNAPSHOT_RETRY_DELAY_MS = 15 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
/** UTC calendar date (`YYYY-MM-DD`) when the monthly job last succeeded. */
let lastSuccessRunDay: string | null = null;
let nextRetryAt: number | null = null;
let inFlight = false;

export function resetOnRepeatSnapshotSchedulerForTests(): void {
  lastSuccessRunDay = null;
  nextRetryAt = null;
  inFlight = false;
}

export function stopOnRepeatSnapshotScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export async function processOnRepeatSnapshotTick(options?: {
  now?: Date;
  skipPrimaryCheck?: boolean;
  run?: typeof generateOnRepeatSnapshotsForMonth;
}): Promise<void> {
  if (inFlight) return;

  const now = options?.now ?? new Date();
  if (now.getUTCDate() !== 1) return;
  if (now.getUTCHours() < ON_REPEAT_SNAPSHOT_HOUR_UTC) return;

  const runDay = now.toISOString().slice(0, 10);
  if (lastSuccessRunDay === runDay) return;
  if (nextRetryAt !== null && now.getTime() < nextRetryAt) return;

  inFlight = true;
  try {
    if (!options?.skipPrimaryCheck) {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
    }

    const run = options?.run ?? generateOnRepeatSnapshotsForMonth;
    await run({ asOf: now });
    lastSuccessRunDay = runDay;
    nextRetryAt = null;
  } catch (error) {
    nextRetryAt = now.getTime() + ON_REPEAT_SNAPSHOT_RETRY_DELAY_MS;
    console.error("On-repeat snapshot tick failed", error);
  } finally {
    inFlight = false;
  }
}

export function scheduleOnRepeatSnapshots(): void {
  if (intervalHandle !== null) return;

  const runTick = () => {
    void processOnRepeatSnapshotTick();
  };

  void runTick();
  intervalHandle = setInterval(runTick, ON_REPEAT_SNAPSHOT_TICK_INTERVAL_MS);
  console.log(
    `On-repeat snapshot scheduler started (day: 1st, hour UTC: ${ON_REPEAT_SNAPSHOT_HOUR_UTC}, tick: ${ON_REPEAT_SNAPSHOT_TICK_INTERVAL_MS}ms)`,
  );
}
