/**
 * In-process retention for security events. Same LiteFS-primary interval
 * pattern as the Party Room sweeper and the backup scheduler.
 * Deletes non-perpetual rows older than 90 days; perpetual audit rows stay.
 */
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { deleteExpiredSecurityEvents } from "./track-event.server.ts";

export const SECURITY_EVENT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function stopSecurityEventSweeper(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function startSecurityEventSweeper(intervalMs = SECURITY_EVENT_SWEEP_INTERVAL_MS): void {
  if (intervalHandle) return;

  const runTick = async () => {
    try {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
      const deleted = await deleteExpiredSecurityEvents();
      if (deleted > 0) {
        console.log(`Security event retention deleted ${deleted} expired event(s)`);
      }
    } catch (error) {
      console.error("Security event retention sweep failed", error);
    }
  };

  void runTick();
  intervalHandle = setInterval(runTick, intervalMs);
}
