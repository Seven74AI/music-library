import { expect, test } from "vitest";
import { outcomeFromPlayCall, roomStateAfterAutoplay } from "./audio-player-room-playback.ts";

test("blocked autoplay leaves the room paused and does not report playback as playing", () => {
  const next = roomStateAfterAutoplay("blocked");
  expect(next.isPlaying).toBe(false);
  expect(next.reportPlaying).toBe(false);
  expect(next.explanation).toEqual(expect.any(String));
  expect(next.explanation).toMatch(/play/i);
});

test("room playback is reported as playing only after audio starts", () => {
  const next = roomStateAfterAutoplay("started");
  expect(next.isPlaying).toBe(true);
  expect(next.reportPlaying).toBe(true);
  expect(next.explanation).toBeNull();
});

test("a rejected or missing play() call is a blocked room autoplay", async () => {
  await expect(outcomeFromPlayCall(Promise.reject(new Error("NotAllowedError")))).resolves.toBe(
    "blocked",
  );
  await expect(outcomeFromPlayCall(undefined)).resolves.toBe("blocked");
  await expect(outcomeFromPlayCall(Promise.resolve())).resolves.toBe("started");
});
