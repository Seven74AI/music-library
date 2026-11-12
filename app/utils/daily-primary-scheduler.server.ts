import { getInstanceInfo } from "./litefs.server.ts";

export type DailyPrimaryJobResult = { success: boolean };

export type DailyPrimaryRun = () => Promise<DailyPrimaryJobResult>;

export type CreateDailyPrimarySchedulerOptions = {
  hourUtc: number;
  retryDelayMs: number;
  tickIntervalMs: number;
  logLabel: string;
  tickFailedLogMessage: string;
  defaultRun: DailyPrimaryRun;
};

export type DailyPrimaryScheduler = {
  processTick: (options?: {
    now?: Date;
    skipPrimaryCheck?: boolean;
    run?: DailyPrimaryRun;
  }) => Promise<void>;
  schedule: () => void;
  stop: () => void;
  resetForTests: () => void;
};

export function createDailyPrimaryScheduler(
  options: CreateDailyPrimarySchedulerOptions,
): DailyPrimaryScheduler {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let lastSuccessDay: string | null = null;
  let nextRetryAt: number | null = null;
  let inFlight = false;

  async function processTick(tickOptions?: {
    now?: Date;
    skipPrimaryCheck?: boolean;
    run?: DailyPrimaryRun;
  }): Promise<void> {
    if (inFlight) return;

    const now = tickOptions?.now ?? new Date();
    if (now.getUTCHours() < options.hourUtc) return;

    const day = now.toISOString().slice(0, 10);
    if (lastSuccessDay === day) return;
    if (nextRetryAt !== null && now.getTime() < nextRetryAt) return;

    inFlight = true;
    try {
      if (!tickOptions?.skipPrimaryCheck) {
        const { currentIsPrimary } = await getInstanceInfo();
        if (!currentIsPrimary) return;
      }

      const run = tickOptions?.run ?? options.defaultRun;
      const result = await run();
      if (result.success) {
        lastSuccessDay = day;
        nextRetryAt = null;
        return;
      }

      nextRetryAt = now.getTime() + options.retryDelayMs;
    } catch (error) {
      nextRetryAt = now.getTime() + options.retryDelayMs;
      console.error(options.tickFailedLogMessage, error);
    } finally {
      inFlight = false;
    }
  }

  function schedule(): void {
    if (intervalHandle !== null) return;

    const runTick = () => {
      void processTick();
    };

    void runTick();
    intervalHandle = setInterval(runTick, options.tickIntervalMs);
    console.log(
      `${options.logLabel} scheduler started (hour UTC: ${options.hourUtc}, tick: ${options.tickIntervalMs}ms)`,
    );
  }

  function stop(): void {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function resetForTests(): void {
    lastSuccessDay = null;
    nextRetryAt = null;
    inFlight = false;
  }

  return {
    processTick,
    schedule,
    stop,
    resetForTests,
  };
}
