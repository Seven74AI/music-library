/**
 * In-process scheduler for daily SQLite backups (~BACKUP_HOUR_UTC, default 03:00 UTC).
 *
 * Same-day retries with backoff; Telegram after exhausting retries.
 */
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { formatUtcDate } from "./backup-keys.ts";
import { runBackup } from "./backup.server.ts";
import { isBackupBucketConfigured } from "./backup-storage.server.ts";
import {
  loadPersistedSchedulerState,
  persistSchedulerState,
  type PersistedSchedulerState,
} from "./scheduler-state.server.ts";
import { notifyBackupFailed } from "./notification.server.ts";

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

function snapshotPersistedState(): PersistedSchedulerState {
  return {
    lastSuccessDay: state.lastSuccessDay,
    attemptsToday: state.attemptsToday,
    attemptDay: state.attemptDay,
    nextRetryAt: state.nextRetryAt,
  };
}

function applyPersistedState(persisted: PersistedSchedulerState): void {
  state.lastSuccessDay = persisted.lastSuccessDay;
  state.attemptsToday = persisted.attemptsToday;
  state.attemptDay = persisted.attemptDay;
  state.nextRetryAt = persisted.nextRetryAt;
}

async function hydrateSchedulerStateFromDb(): Promise<void> {
  applyPersistedState(await loadPersistedSchedulerState());
}

async function saveSchedulerStateToDb(): Promise<void> {
  await persistSchedulerState(snapshotPersistedState());
}

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
  /** When true, use in-memory state only (unit tests). Production persists to BackupState. */
  skipPersistence?: boolean;
}): Promise<void> {
  if (!isBackupBucketConfigured()) return;
  if (state.inFlight) return;

  state.inFlight = true;
  const now = options?.now ?? new Date();
  try {
    if (!options?.skipPersistence) {
      await hydrateSchedulerStateFromDb();
    }

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
      if (!options?.skipPersistence) {
        await saveSchedulerStateToDb();
      }
    }

    // Already succeeded today
    if (state.lastSuccessDay === day) return;

    // Wait until backup hour
    if (now.getUTCHours() < hour) return;

    // Wait for retry backoff
    if (state.nextRetryAt !== null && now.getTime() < state.nextRetryAt) return;

    // Exhausted retries for the day
    if (state.attemptsToday >= BACKUP_SCHEDULER_MAX_ATTEMPTS) return;

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
      if (!options?.skipPersistence) {
        await saveSchedulerStateToDb();
      }
      return;
    }

    if (result.skipped) {
      // Not configured / not primary — don't burn retries
      state.attemptsToday = Math.max(0, state.attemptsToday - 1);
      if (!options?.skipPersistence) {
        await saveSchedulerStateToDb();
      }
      return;
    }

    if (state.attemptsToday < BACKUP_SCHEDULER_MAX_ATTEMPTS) {
      state.nextRetryAt = now.getTime() + BACKUP_SCHEDULER_RETRY_DELAY_MS;
    } else {
      state.nextRetryAt = null;
    }
    if (!options?.skipPersistence) {
      await saveSchedulerStateToDb();
    }
  } catch (error) {
    console.error("Backup scheduler tick failed", error);
    const attemptCount = state.attemptsToday + 1;
    state.attemptsToday = attemptCount;
    if (attemptCount >= BACKUP_SCHEDULER_MAX_ATTEMPTS) {
      const message = error instanceof Error ? error.message : String(error);
      void notifyBackupFailed(message, attemptCount);
      state.nextRetryAt = null;
    } else {
      state.nextRetryAt = now.getTime() + BACKUP_SCHEDULER_RETRY_DELAY_MS;
    }
    if (!options?.skipPersistence) {
      try {
        await saveSchedulerStateToDb();
      } catch (persistError) {
        console.error("Failed to persist backup scheduler state after tick failure", persistError);
      }
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
    void processBackupSchedulerTick().catch((error) => {
      console.error("Backup scheduler tick failed", error);
    });
  };
  void runTick();
  intervalHandle = setInterval(runTick, TICK_INTERVAL_MS);
  console.log(
    `SQLite backup scheduler started (hour UTC: ${getBackupHourUtc()}, tick: ${TICK_INTERVAL_MS}ms)`,
  );
}
