/**
 * In-process scheduler for daily SQLite backups (~BACKUP_HOUR_UTC, default 03:00 UTC).
 *
 * Same-day retries with backoff; Telegram after exhausting retries.
 */
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { formatUtcDate } from "./backup-keys.ts";
import { runBackup } from "./backup.server.ts";
import { isBackupBucketConfigured } from "./backup-storage.server.ts";

const DEFAULT_HOUR_UTC = 3;
export const BACKUP_SCHEDULER_MAX_ATTEMPTS = 3;
export const BACKUP_SCHEDULER_RETRY_DELAY_MS = 15 * 60 * 1000; // 15 minutes
const TICK_INTERVAL_MS = 60 * 1000; // check every minute

type SchedulerState = {
  lastSuccessDay: string | null;
  attemptsToday: number;
  attemptDay: string | null;
  nextRetryAt: number | null;
  inFlight: boolean;
};

const state: SchedulerState = {
  lastSuccessDay: null,
  attemptsToday: 0,
  attemptDay: null,
  nextRetryAt: null,
  inFlight: false,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function getBackupHourUtc(): number {
  const raw = process.env.BACKUP_HOUR_UTC;
  if (raw === undefined || raw === "") return DEFAULT_HOUR_UTC;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 23) return DEFAULT_HOUR_UTC;
  return Math.floor(n);
}

export function resetBackupSchedulerStateForTests(): void {
  state.lastSuccessDay = null;
  state.attemptsToday = 0;
  state.attemptDay = null;
  state.nextRetryAt = null;
  state.inFlight = false;
}

export function stopBackupScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * One scheduler tick. Exported for tests.
 */
export async function processBackupSchedulerTick(options?: {
  now?: Date;
  run?: typeof runBackup;
  skipPrimaryCheck?: boolean;
}): Promise<void> {
  if (!isBackupBucketConfigured()) return;
  if (state.inFlight) return;

  const now = options?.now ?? new Date();
  const day = formatUtcDate(now);
  const hour = getBackupHourUtc();

  if (!options?.skipPrimaryCheck) {
    const { currentIsPrimary } = await getInstanceInfo();
    if (!currentIsPrimary) return;
  }

  // Reset attempt counter on a new UTC day
  if (state.attemptDay !== day) {
    state.attemptDay = day;
    state.attemptsToday = 0;
    state.nextRetryAt = null;
  }

  // Already succeeded today
  if (state.lastSuccessDay === day) return;

  // Wait until backup hour
  if (now.getUTCHours() < hour) return;

  // Wait for retry backoff
  if (state.nextRetryAt !== null && now.getTime() < state.nextRetryAt) return;

  // Exhausted retries for the day
  if (state.attemptsToday >= BACKUP_SCHEDULER_MAX_ATTEMPTS) return;

  state.inFlight = true;
  try {
    const attemptCount = state.attemptsToday + 1;
    const notifyOnFailure = attemptCount >= BACKUP_SCHEDULER_MAX_ATTEMPTS;
    const run = options?.run ?? runBackup;
    const result = await run({
      now,
      skipPrimaryCheck: true, // already checked above
      attemptCount,
      notifyOnFailure,
    });

    state.attemptsToday = attemptCount;

    if (result.ok) {
      state.lastSuccessDay = day;
      state.nextRetryAt = null;
      return;
    }

    if (result.skipped) {
      // Not configured / not primary — don't burn retries
      state.attemptsToday = Math.max(0, state.attemptsToday - 1);
      return;
    }

    if (state.attemptsToday < BACKUP_SCHEDULER_MAX_ATTEMPTS) {
      state.nextRetryAt = now.getTime() + BACKUP_SCHEDULER_RETRY_DELAY_MS;
    } else {
      state.nextRetryAt = null;
    }
  } finally {
    state.inFlight = false;
  }
}

export function startBackupScheduler(): void {
  if (intervalHandle) return;
  if (!isBackupBucketConfigured()) {
    console.log("SQLite backup scheduler not started (BACKUP_BUCKET_NAME unset)");
    return;
  }

  const runTick = () => {
    void processBackupSchedulerTick();
  };
  void runTick();
  intervalHandle = setInterval(runTick, TICK_INTERVAL_MS);
  console.log(
    `SQLite backup scheduler started (hour UTC: ${getBackupHourUtc()}, tick: ${TICK_INTERVAL_MS}ms)`,
  );
}
