import { afterEach, describe, expect, test, vi } from "vitest";
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import {
  ON_REPEAT_SNAPSHOT_HOUR_UTC,
  ON_REPEAT_SNAPSHOT_TICK_INTERVAL_MS,
  processOnRepeatSnapshotTick,
  resetOnRepeatSnapshotSchedulerForTests,
  scheduleOnRepeatSnapshots,
  stopOnRepeatSnapshotScheduler,
} from "./scheduler.server.ts";
import { generateOnRepeatSnapshotsForMonth } from "./generate.server.ts";

vi.mock("#app/utils/litefs.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/litefs.server.ts")>();
  return {
    ...actual,
    getInstanceInfo: vi.fn(async () => ({
      currentIsPrimary: true,
      primaryInstance: "test",
      currentInstance: "test",
    })),
  };
});

afterEach(() => {
  stopOnRepeatSnapshotScheduler();
  resetOnRepeatSnapshotSchedulerForTests();
});

describe("processOnRepeatSnapshotTick", () => {
  test("runs on the 1st at or after 02:00 UTC and only once that day", async () => {
    resetOnRepeatSnapshotSchedulerForTests();
    const run = vi.fn<typeof generateOnRepeatSnapshotsForMonth>().mockResolvedValue({
      yearMonth: "2026-10",
      created: 1,
      skippedEmpty: 0,
      alreadyExists: 0,
    });

    await processOnRepeatSnapshotTick({
      now: new Date("2026-10-02T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).not.toHaveBeenCalled();

    await processOnRepeatSnapshotTick({
      now: new Date("2026-11-01T01:59:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).not.toHaveBeenCalled();

    await processOnRepeatSnapshotTick({
      now: new Date("2026-11-01T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ asOf: new Date("2026-11-01T02:00:00.000Z") });

    await processOnRepeatSnapshotTick({
      now: new Date("2026-11-01T03:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await processOnRepeatSnapshotTick({
      now: new Date("2026-12-01T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("does not run on a LiteFS replica", async () => {
    resetOnRepeatSnapshotSchedulerForTests();
    vi.mocked(getInstanceInfo).mockResolvedValueOnce({
      currentIsPrimary: false,
      primaryInstance: "primary",
      currentInstance: "replica",
    });
    const run = vi.fn<typeof generateOnRepeatSnapshotsForMonth>().mockResolvedValue({
      yearMonth: "2026-09",
      created: 0,
      skippedEmpty: 0,
      alreadyExists: 0,
    });

    await processOnRepeatSnapshotTick({
      now: new Date("2026-11-01T02:30:00.000Z"),
      run,
    });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("scheduleOnRepeatSnapshots", () => {
  test("registers a single interval", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    scheduleOnRepeatSnapshots();
    scheduleOnRepeatSnapshots();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      ON_REPEAT_SNAPSHOT_TICK_INTERVAL_MS,
    );
    expect(ON_REPEAT_SNAPSHOT_HOUR_UTC).toBe(2);

    vi.useRealTimers();
  });
});
