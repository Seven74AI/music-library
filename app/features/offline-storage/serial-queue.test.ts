import { describe, expect, test } from "vitest";
import { offlineAudioStagingTrackId } from "./offline-audio-path.ts";
import { createSerialQueue } from "./serial-queue.ts";

describe("createSerialQueue", () => {
  test("does not interleave overlapping tasks", async () => {
    const enqueue = createSerialQueue();
    const events: string[] = [];
    const task = (name: string, ticks: number) => async () => {
      events.push(`${name}:start`);
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      events.push(`${name}:end`);
    };

    await Promise.all([enqueue(task("write", 5)), enqueue(task("commit", 1)), enqueue(task("read", 3))]);

    expect(events).toEqual([
      "write:start",
      "write:end",
      "commit:start",
      "commit:end",
      "read:start",
      "read:end",
    ]);
  });

  test("a rejected task does not block later tasks", async () => {
    const enqueue = createSerialQueue();
    const failing = enqueue(async () => {
      throw new Error("boom");
    });
    const next = enqueue(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});

describe("offlineAudioStagingTrackId", () => {
  test("is unique per call so concurrent downloads of one track do not collide", () => {
    expect(offlineAudioStagingTrackId("t1")).not.toBe(offlineAudioStagingTrackId("t1"));
    expect(offlineAudioStagingTrackId("t1")).toContain("t1");
  });
});
