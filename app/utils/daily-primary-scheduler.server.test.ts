import { afterEach, describe, expect, test, vi } from "vitest";
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { createDailyPrimaryScheduler } from "./daily-primary-scheduler.server.ts";

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

const HOUR_UTC = 2;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const TICK_INTERVAL_MS = 60 * 1000;

function makeScheduler(run: () => Promise<{ success: boolean }> = async () => ({ success: true })) {
  const runMock = vi.fn(run);
  return {
    scheduler: createDailyPrimaryScheduler({
      hourUtc: HOUR_UTC,
      retryDelayMs: RETRY_DELAY_MS,
      tickIntervalMs: TICK_INTERVAL_MS,
      logLabel: "test job",
      tickFailedLogMessage: "test job tick failed",
      defaultRun: runMock,
    }),
    run: runMock,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createDailyPrimaryScheduler", () => {
  test("jobs wired through createDailyPrimaryScheduler share hour, retry, and gating semantics", async () => {
    const {
      DUPLICATE_DETECTION_HOUR_UTC,
      DUPLICATE_DETECTION_RETRY_DELAY_MS,
      DUPLICATE_DETECTION_TICK_INTERVAL_MS,
    } = await import("./duplicate-detection-scheduler.server.ts");
    const { QUALITY_CHECK_HOUR_UTC, QUALITY_CHECK_RETRY_DELAY_MS, QUALITY_CHECK_TICK_INTERVAL_MS } =
      await import("./quality-check.server.ts");

    expect(DUPLICATE_DETECTION_HOUR_UTC).toBe(QUALITY_CHECK_HOUR_UTC);
    expect(DUPLICATE_DETECTION_RETRY_DELAY_MS).toBe(QUALITY_CHECK_RETRY_DELAY_MS);
    expect(DUPLICATE_DETECTION_TICK_INTERVAL_MS).toBe(QUALITY_CHECK_TICK_INTERVAL_MS);
    expect(HOUR_UTC).toBe(2);
    expect(RETRY_DELAY_MS).toBe(15 * 60 * 1000);
  });

  test("runs once per UTC day at or after hourUtc with 15-minute retry backoff", async () => {
    const run = vi
      .fn(async (): Promise<{ success: boolean }> => ({ success: true }))
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValue({ success: true });
    const { scheduler } = makeScheduler(run);
    scheduler.resetForTests();

    await scheduler.processTick({
      now: new Date("2026-10-04T01:59:00.000Z"),
      skipPrimaryCheck: true,
    });
    expect(run).not.toHaveBeenCalled();

    await scheduler.processTick({
      now: new Date("2026-10-04T02:00:00.000Z"),
      skipPrimaryCheck: true,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await scheduler.processTick({
      now: new Date("2026-10-04T02:01:00.000Z"),
      skipPrimaryCheck: true,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await scheduler.processTick({
      now: new Date(new Date("2026-10-04T02:00:00.000Z").getTime() + RETRY_DELAY_MS),
      skipPrimaryCheck: true,
    });
    expect(run).toHaveBeenCalledTimes(2);

    await scheduler.processTick({
      now: new Date("2026-10-05T02:00:00.000Z"),
      skipPrimaryCheck: true,
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  test("does not run on a LiteFS replica", async () => {
    const run = vi.fn(async (): Promise<{ success: boolean }> => ({ success: true }));
    const { scheduler } = makeScheduler(run);
    scheduler.resetForTests();

    vi.mocked(getInstanceInfo).mockResolvedValueOnce({
      currentIsPrimary: false,
      primaryInstance: "primary",
      currentInstance: "replica",
    });

    await scheduler.processTick({
      now: new Date("2026-10-04T02:30:00.000Z"),
    });

    expect(run).not.toHaveBeenCalled();
  });

  test("skips overlapping ticks while in flight", async () => {
    let release!: () => void;
    const run = vi.fn(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          release = () => resolve({ success: true });
        }),
    );
    const { scheduler } = makeScheduler(run);
    scheduler.resetForTests();

    const first = scheduler.processTick({
      now: new Date("2026-10-04T02:00:00.000Z"),
      skipPrimaryCheck: true,
    });
    await scheduler.processTick({
      now: new Date("2026-10-04T02:00:30.000Z"),
      skipPrimaryCheck: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  test("schedule registers a single interval", () => {
    vi.useFakeTimers();
    const { scheduler } = makeScheduler();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    scheduler.schedule();
    scheduler.schedule();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), TICK_INTERVAL_MS);

    scheduler.stop();
    vi.useRealTimers();
  });
});
