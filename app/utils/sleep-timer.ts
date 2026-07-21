export const SLEEP_TIMER_PRESETS_MINUTES = [15, 30, 45, 60] as const;

export type SleepTimerPresetMinutes = (typeof SLEEP_TIMER_PRESETS_MINUTES)[number];

export function createSleepTimerEndAt(minutes: number, now = Date.now()): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return now + minutes * 60_000;
}

export function getSleepTimerRemainingMs(endAt: number | null, now = Date.now()): number {
  if (endAt === null) return 0;
  return Math.max(0, endAt - now);
}

export function formatSleepTimerRemaining(endAt: number | null, now = Date.now()): string | null {
  const remainingMs = getSleepTimerRemainingMs(endAt, now);
  if (remainingMs <= 0) return null;

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function isSleepTimerExpired(endAt: number | null, now = Date.now()): boolean {
  return endAt !== null && endAt <= now;
}
