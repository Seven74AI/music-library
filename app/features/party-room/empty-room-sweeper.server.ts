/**
 * In-process sweeper for abandoned empty Party Rooms (ADR-030 ~45m TTL).
 * Same pattern as audio-archive / backup schedulers — LiteFS primary only.
 */

import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { sweepExpiredEmptyRooms } from "./party-room.server.ts";

/** Default: every 5 minutes. */
export const EMPTY_ROOM_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function stopEmptyRoomSweeper(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function startEmptyRoomSweeper(intervalMs = EMPTY_ROOM_SWEEP_INTERVAL_MS): void {
  if (intervalHandle) return;

  const runTick = async () => {
    try {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
      const closed = await sweepExpiredEmptyRooms();
      if (closed.length > 0) {
        console.log(`Party Room sweeper ended ${closed.length} empty room(s)`);
      }
    } catch (error) {
      console.error("Party Room empty-room sweep failed", error);
    }
  };

  void runTick();
  intervalHandle = setInterval(runTick, intervalMs);
}
