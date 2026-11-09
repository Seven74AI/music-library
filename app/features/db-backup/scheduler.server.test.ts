import { expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { clearPersistedSchedulerStateForTests } from "./scheduler-state.server.ts";

const mockNotifyBackupFailed = vi.fn().mockResolvedValue(undefined);
vi.mock("./notification.server.ts", () => ({
  notifyBackupFailed: (...args: unknown[]) => mockNotifyBackupFailed(...args),
}));
import {
  BACKUP_SCHEDULER_RETRY_DELAY_MS,
  getBackupHourUtc,
  processBackupSchedulerTick,
  resetBackupSchedulerStateForTests,
} from "./scheduler.server.ts";

test("getBackupHourUtc defaults to 3 and validates range", () => {
  const original = process.env.BACKUP_HOUR_UTC;
  delete process.env.BACKUP_HOUR_UTC;
  expect(getBackupHourUtc()).toBe(3);
  process.env.BACKUP_HOUR_UTC = "5";
  expect(getBackupHourUtc()).toBe(5);
  process.env.BACKUP_HOUR_UTC = "99";
  expect(getBackupHourUtc()).toBe(3);
  if (original !== undefined) process.env.BACKUP_HOUR_UTC = original;
  else delete process.env.BACKUP_HOUR_UTC;
});

test("scheduler does nothing before backup hour", async () => {
  process.env.BACKUP_BUCKET_NAME = "b";
  resetBackupSchedulerStateForTests();
  const run = vi.fn(async () => ({ ok: true as const, dailyKey: "d", weeklyKey: "w" }));

  await processBackupSchedulerTick({
    now: new Date("2026-09-28T02:00:00.000Z"),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).not.toHaveBeenCalled();
});

test("scheduler runs once per day and retries on failure then notifies on last attempt", async () => {
  process.env.BACKUP_BUCKET_NAME = "b";
  process.env.BACKUP_HOUR_UTC = "3";
  resetBackupSchedulerStateForTests();

  const run = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: "fail-1" })
    .mockResolvedValueOnce({ ok: false, error: "fail-2" })
    .mockResolvedValueOnce({ ok: false, error: "fail-3" });

  const t0 = new Date("2026-09-28T03:00:00.000Z");
  await processBackupSchedulerTick({
    now: t0,
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]![0]).toMatchObject({ attemptCount: 1, notifyOnFailure: false });

  // Too soon for retry
  await processBackupSchedulerTick({
    now: new Date(t0.getTime() + 60_000),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(1);

  // After backoff
  await processBackupSchedulerTick({
    now: new Date(t0.getTime() + BACKUP_SCHEDULER_RETRY_DELAY_MS + 1),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1]![0]).toMatchObject({ attemptCount: 2, notifyOnFailure: false });

  await processBackupSchedulerTick({
    now: new Date(t0.getTime() + 2 * BACKUP_SCHEDULER_RETRY_DELAY_MS + 1),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(3);
  expect(run.mock.calls[2]![0]).toMatchObject({
    attemptCount: 3,
    notifyOnFailure: true,
  });

  // Exhausted
  mockNotifyBackupFailed.mockClear();
  await processBackupSchedulerTick({
    now: new Date(t0.getTime() + 3 * BACKUP_SCHEDULER_RETRY_DELAY_MS + 1),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(3);
  expect(mockNotifyBackupFailed).not.toHaveBeenCalled();
});

test("after attempt cap, further ticks do not run backup or notify", async () => {
  process.env.BACKUP_BUCKET_NAME = "b";
  process.env.BACKUP_HOUR_UTC = "3";
  resetBackupSchedulerStateForTests();
  mockNotifyBackupFailed.mockClear();

  const run = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: "fail-1" })
    .mockResolvedValueOnce({ ok: false, error: "fail-2" })
    .mockResolvedValueOnce({ ok: false, error: "fail-3" });

  const t0 = new Date("2026-09-28T03:00:00.000Z");
  for (let i = 0; i < 3; i++) {
    await processBackupSchedulerTick({
      now: new Date(t0.getTime() + i * BACKUP_SCHEDULER_RETRY_DELAY_MS + (i === 0 ? 0 : 1)),
      skipPrimaryCheck: true,
      skipPersistence: true,
      run,
    });
  }
  expect(run).toHaveBeenCalledTimes(3);

  mockNotifyBackupFailed.mockClear();
  run.mockClear();

  await processBackupSchedulerTick({
    now: new Date(t0.getTime() + 4 * BACKUP_SCHEDULER_RETRY_DELAY_MS),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).not.toHaveBeenCalled();
  expect(mockNotifyBackupFailed).not.toHaveBeenCalled();
});

test("scheduler stops after success for the UTC day", async () => {
  process.env.BACKUP_BUCKET_NAME = "b";
  resetBackupSchedulerStateForTests();
  const run = vi.fn(async () => ({ ok: true as const, dailyKey: "d", weeklyKey: "w" }));

  await processBackupSchedulerTick({
    now: new Date("2026-09-28T03:05:00.000Z"),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  await processBackupSchedulerTick({
    now: new Date("2026-09-28T04:00:00.000Z"),
    skipPrimaryCheck: true,
    skipPersistence: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(1);
});

test("pre-run throw consumes an attempt and notifies on the last one", async () => {
  consoleError.mockImplementation(() => {});
  try {
    process.env.BACKUP_BUCKET_NAME = "b";
    process.env.BACKUP_HOUR_UTC = "3";
    resetBackupSchedulerStateForTests();
    mockNotifyBackupFailed.mockClear();

    const run = vi.fn().mockRejectedValue(new Error("markBackupRunning failed"));

    const t0 = new Date("2026-09-28T03:00:00.000Z");
    await processBackupSchedulerTick({
      now: t0,
      skipPrimaryCheck: true,
      skipPersistence: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockNotifyBackupFailed).not.toHaveBeenCalled();

    await processBackupSchedulerTick({
      now: new Date(t0.getTime() + BACKUP_SCHEDULER_RETRY_DELAY_MS + 1),
      skipPrimaryCheck: true,
      skipPersistence: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(mockNotifyBackupFailed).not.toHaveBeenCalled();

    await processBackupSchedulerTick({
      now: new Date(t0.getTime() + 2 * BACKUP_SCHEDULER_RETRY_DELAY_MS + 1),
      skipPrimaryCheck: true,
      skipPersistence: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(mockNotifyBackupFailed).toHaveBeenCalledWith("markBackupRunning failed", 3);
  } finally {
    consoleError.mockReset();
  }
});

test("scheduler restores persisted retry count after process restart", async () => {
  process.env.BACKUP_BUCKET_NAME = "b";
  process.env.BACKUP_HOUR_UTC = "3";
  await clearPersistedSchedulerStateForTests();
  resetBackupSchedulerStateForTests();

  const run = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: "fail-1" })
    .mockResolvedValueOnce({ ok: false, error: "fail-2" });

  const t0 = new Date("2026-09-28T03:00:00.000Z");
  await processBackupSchedulerTick({ now: t0, skipPrimaryCheck: true, run });
  expect(run).toHaveBeenCalledTimes(1);

  // Simulate restart: in-memory state lost, DB row retained
  resetBackupSchedulerStateForTests();

  await processBackupSchedulerTick({
    now: new Date(t0.getTime() + BACKUP_SCHEDULER_RETRY_DELAY_MS + 1),
    skipPrimaryCheck: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1]![0]).toMatchObject({ attemptCount: 2, notifyOnFailure: false });
});

test("scheduler skips re-running backup after persisted success for the UTC day", async () => {
  process.env.BACKUP_BUCKET_NAME = "b";
  process.env.BACKUP_HOUR_UTC = "3";
  await clearPersistedSchedulerStateForTests();
  resetBackupSchedulerStateForTests();

  const run = vi.fn(async () => ({ ok: true as const, dailyKey: "d", weeklyKey: "w" }));

  await processBackupSchedulerTick({
    now: new Date("2026-09-28T03:05:00.000Z"),
    skipPrimaryCheck: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(1);

  resetBackupSchedulerStateForTests();

  await processBackupSchedulerTick({
    now: new Date("2026-09-28T04:00:00.000Z"),
    skipPrimaryCheck: true,
    run,
  });
  expect(run).toHaveBeenCalledTimes(1);
});
