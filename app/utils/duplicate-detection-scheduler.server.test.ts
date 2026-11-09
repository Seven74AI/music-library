import { afterEach, describe, expect, test, vi } from "vitest";
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import {
  DUPLICATE_DETECTION_HOUR_UTC,
  DUPLICATE_DETECTION_RETRY_DELAY_MS,
  DUPLICATE_DETECTION_TICK_INTERVAL_MS,
  processDuplicateDetectionTick,
  resetDuplicateDetectionSchedulerForTests,
  scheduleDuplicateDetection,
  stopDuplicateDetectionScheduler,
} from "./duplicate-detection-scheduler.server.ts";
import {
  type DuplicateDetectionJobResult,
  runDuplicateDetectionJob,
} from "./duplicate-detection-job.server.ts";

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

const successResult: DuplicateDetectionJobResult = {
  success: true,
  startedAt: new Date(),
  completedAt: new Date(),
  durationMs: 1,
  artistsProcessed: 0,
  albumsProcessed: 0,
  exactArtistGroups: 0,
  fuzzyArtistGroups: 0,
  exactAlbumGroups: 0,
  fuzzyAlbumGroups: 0,
};

afterEach(() => {
  stopDuplicateDetectionScheduler();
  resetDuplicateDetectionSchedulerForTests();
});

describe("processDuplicateDetectionTick", () => {
  test("runs once per UTC day at or after 02:00", async () => {
    resetDuplicateDetectionSchedulerForTests();
    const run = vi
      .fn<typeof runDuplicateDetectionJob>()
      .mockResolvedValueOnce({ ...successResult, success: false, error: "db down" })
      .mockResolvedValue(successResult);

    await processDuplicateDetectionTick({
      now: new Date("2026-10-04T01:59:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).not.toHaveBeenCalled();

    await processDuplicateDetectionTick({
      now: new Date("2026-10-04T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await processDuplicateDetectionTick({
      now: new Date(
        new Date("2026-10-04T02:00:00.000Z").getTime() + DUPLICATE_DETECTION_RETRY_DELAY_MS,
      ),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);

    await processDuplicateDetectionTick({
      now: new Date("2026-10-05T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  test("does not run on a LiteFS replica", async () => {
    resetDuplicateDetectionSchedulerForTests();
    vi.mocked(getInstanceInfo).mockResolvedValueOnce({
      currentIsPrimary: false,
      primaryInstance: "primary",
      currentInstance: "replica",
    });
    const run = vi.fn<typeof runDuplicateDetectionJob>().mockResolvedValue(successResult);

    await processDuplicateDetectionTick({
      now: new Date("2026-10-04T02:30:00.000Z"),
      run,
    });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("scheduleDuplicateDetection", () => {
  test("registers a single interval", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    scheduleDuplicateDetection();
    scheduleDuplicateDetection();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      DUPLICATE_DETECTION_TICK_INTERVAL_MS,
    );
    expect(DUPLICATE_DETECTION_HOUR_UTC).toBe(2);

    vi.useRealTimers();
  });
});
