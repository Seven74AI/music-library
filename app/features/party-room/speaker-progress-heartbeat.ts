import { ROOM_HOST_HEARTBEAT_INTERVAL_MS } from "./constants.ts";

/**
 * Speaker presence while a locked screen throttles page timers.
 * Heartbeat only when this device is the room speaker and the playhead is
 * actually moving. Pause, a stall, or leaving speaker mode stops the clock.
 */
export function speakerProgressHeartbeatDue(input: {
  active: boolean;
  paused: boolean;
  seeking: boolean;
  currentTime: number;
  previousTime: number | null;
  lastSentAtMs: number;
  nowMs: number;
  minIntervalMs?: number;
}): { due: boolean; previousTime: number | null } {
  const minIntervalMs = input.minIntervalMs ?? ROOM_HOST_HEARTBEAT_INTERVAL_MS;
  if (!input.active || input.paused || !Number.isFinite(input.currentTime)) {
    return {
      due: false,
      previousTime: input.paused || !input.active ? null : input.previousTime,
    };
  }

  // A new track or a backward seek restarts the baseline. That jump is not playback.
  if (input.previousTime !== null && input.currentTime < input.previousTime) {
    return { due: false, previousTime: input.currentTime };
  }

  const advanced =
    !input.seeking && input.previousTime !== null && input.currentTime > input.previousTime;
  const due = advanced && input.nowMs - input.lastSentAtMs >= minIntervalMs;
  return { due, previousTime: input.currentTime };
}
