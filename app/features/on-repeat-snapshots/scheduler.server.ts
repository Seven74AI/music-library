import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { generateOnRepeatSnapshotsForMonth } from "./generate.server.ts";
import { getPreviousCalendarMonthUtc } from "./month.ts";
import {
  loadPersistedOnRepeatSchedulerState,
  persistOnRepeatSchedulerState,
  type PersistedOnRepeatSchedulerState,
} from "./scheduler-state.server.ts";

/** Poll once a minute; generation runs on the 1st at or after 02:00 UTC (ADR-024). */
export const ON_REPEAT_SNAPSHOT_TICK_INTERVAL_MS = 60 * 1000;
export const ON_REPEAT_SNAPSHOT_HOUR_UTC = 2;
export const ON_REPEAT_SNAPSHOT_RETRY_DELAY_MS = 15 * 60 * 1000;
/** Keep same-month retries through UTC day 3 after a failed 1st-of-month run. */
export const ON_REPEAT_SNAPSHOT_RETRY_DEADLINE_UTC_DAY = 3;

type SchedulerState = PersistedOnRepeatSchedulerState & {
  inFlight: boolean;
};

const state: SchedulerState = {
  lastSuccessYearMonth: null,
  nextRetryAt: null,
  inFlight: false,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function snapshotPersistedState(): PersistedOnRepeatSchedulerState {
  return {
    lastSuccessYearMonth: state.lastSuccessYearMonth,
    nextRetryAt: state.nextRetryAt,
  };
}

function applyPersistedState(persisted: PersistedOnRepeatSchedulerState): void {
  state.lastSuccessYearMonth = persisted.lastSuccessYearMonth;
  state.nextRetryAt = persisted.nextRetryAt;
}

async function hydrateSchedulerStateFromDb(): Promise<void> {
  applyPersistedState(await loadPersistedOnRepeatSchedulerState());
}

async function saveSchedulerStateToDb(): Promise<void> {
  await persistOnRepeatSchedulerState(snapshotPersistedState());
}

export function resetOnRepeatSnapshotSchedulerForTests(): void {
  state.lastSuccessYearMonth = null;
  state.nextRetryAt = null;
  state.inFlight = false;
}

export function setOnRepeatSchedulerStateForTests(
  partial: Partial<PersistedOnRepeatSchedulerState>,
): void {
  if (partial.lastSuccessYearMonth !== undefined) {
    state.lastSuccessYearMonth = partial.lastSuccessYearMonth;
  }
  if (partial.nextRetryAt !== undefined) {
    state.nextRetryAt = partial.nextRetryAt;
  }
}

export function stopOnRepeatSnapshotScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function shouldRunMonthlySnapshot(now: Date): boolean {
  const target = getPreviousCalendarMonthUtc(now);
  if (state.lastSuccessYearMonth === target.yearMonth) return false;

  const day = now.getUTCDate();
  const hour = now.getUTCHours();

  if (state.nextRetryAt !== null && now.getTime() < state.nextRetryAt) return false;

  const isScheduledFirst = day === 1 && hour >= ON_REPEAT_SNAPSHOT_HOUR_UTC;
  const isRetryDay =
    day >= 2 && day <= ON_REPEAT_SNAPSHOT_RETRY_DEADLINE_UTC_DAY && state.nextRetryAt !== null;
  const isRestartCatchUp =
    day > 1 &&
    state.lastSuccessYearMonth !== null &&
    state.lastSuccessYearMonth !== target.yearMonth &&
    state.nextRetryAt === null;

  if (!isScheduledFirst && !isRetryDay && !isRestartCatchUp) return false;
  if (day === 1 && hour < ON_REPEAT_SNAPSHOT_HOUR_UTC) return false;

  return true;
}

export async function processOnRepeatSnapshotTick(options?: {
  now?: Date;
  skipPrimaryCheck?: boolean;
  skipPersistence?: boolean;
  run?: typeof generateOnRepeatSnapshotsForMonth;
}): Promise<void> {
  if (state.inFlight) return;

  const now = options?.now ?? new Date();

  if (!options?.skipPersistence) {
    try {
      await hydrateSchedulerStateFromDb();
    } catch (hydrateError) {
      console.error("Failed to hydrate on-repeat scheduler state", hydrateError);
      return;
    }
  }

  if (!shouldRunMonthlySnapshot(now)) return;

  state.inFlight = true;
  try {
    if (!options?.skipPrimaryCheck) {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
    }

    const run = options?.run ?? generateOnRepeatSnapshotsForMonth;
    const summary = await run({ asOf: now });
    state.lastSuccessYearMonth = summary.yearMonth;
    state.nextRetryAt = null;
    if (!options?.skipPersistence) {
      try {
        await saveSchedulerStateToDb();
      } catch (persistError) {
        console.error("Failed to persist on-repeat scheduler state after success", persistError);
      }
    }
  } catch (error) {
    state.nextRetryAt = now.getTime() + ON_REPEAT_SNAPSHOT_RETRY_DELAY_MS;
    if (!options?.skipPersistence) {
      try {
        await saveSchedulerStateToDb();
      } catch (persistError) {
        console.error("Failed to persist on-repeat scheduler state after failure", persistError);
      }
    }
    console.error("On-repeat snapshot tick failed", error);
  } finally {
    state.inFlight = false;
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
