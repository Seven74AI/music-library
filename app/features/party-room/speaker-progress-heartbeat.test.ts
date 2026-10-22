import { describe, expect, test } from "vitest";
import { ROOM_HOST_HEARTBEAT_INTERVAL_MS } from "./constants.ts";
import { speakerProgressHeartbeatDue } from "./speaker-progress-heartbeat.ts";

const interval = ROOM_HOST_HEARTBEAT_INTERVAL_MS;

describe("speaker progress heartbeats", () => {
  test("sends only while playback time is advancing and the interval has elapsed", () => {
    const first = speakerProgressHeartbeatDue({
      active: true,
      paused: false,
      seeking: false,
      currentTime: 1,
      previousTime: null,
      lastSentAtMs: 0,
      nowMs: 10_000,
    });
    expect(first.due).toBe(false);
    expect(first.previousTime).toBe(1);

    const tooSoon = speakerProgressHeartbeatDue({
      active: true,
      paused: false,
      seeking: false,
      currentTime: 1.25,
      previousTime: first.previousTime,
      lastSentAtMs: 0,
      nowMs: interval - 1,
    });
    expect(tooSoon.due).toBe(false);

    const due = speakerProgressHeartbeatDue({
      active: true,
      paused: false,
      seeking: false,
      currentTime: 4,
      previousTime: tooSoon.previousTime,
      lastSentAtMs: 0,
      nowMs: interval,
    });
    expect(due.due).toBe(true);
    expect(due.previousTime).toBe(4);
  });

  test("stops when sound stops, when time is not moving, or when this device is not the speaker", () => {
    expect(
      speakerProgressHeartbeatDue({
        active: true,
        paused: true,
        seeking: false,
        currentTime: 12,
        previousTime: 10,
        lastSentAtMs: 0,
        nowMs: interval * 2,
      }),
    ).toEqual({ due: false, previousTime: null });

    expect(
      speakerProgressHeartbeatDue({
        active: true,
        paused: false,
        seeking: false,
        currentTime: 10,
        previousTime: 10,
        lastSentAtMs: 0,
        nowMs: interval * 2,
      }).due,
    ).toBe(false);

    expect(
      speakerProgressHeartbeatDue({
        active: false,
        paused: false,
        seeking: false,
        currentTime: 12,
        previousTime: 10,
        lastSentAtMs: 0,
        nowMs: interval * 2,
      }).due,
    ).toBe(false);
  });

  test("a backward jump resets the baseline instead of counting as progress", () => {
    const reset = speakerProgressHeartbeatDue({
      active: true,
      paused: false,
      seeking: false,
      currentTime: 0,
      previousTime: 40,
      lastSentAtMs: 0,
      nowMs: interval * 2,
    });
    expect(reset).toEqual({ due: false, previousTime: 0 });
  });

  test("seeking does not send, even if the playhead moves", () => {
    const seeking = speakerProgressHeartbeatDue({
      active: true,
      paused: false,
      seeking: true,
      currentTime: 30,
      previousTime: 10,
      lastSentAtMs: 0,
      nowMs: interval * 2,
    });
    expect(seeking.due).toBe(false);
    expect(seeking.previousTime).toBe(30);
  });
});
