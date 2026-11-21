import { expect, test } from "vitest";
import { hasReadyKaraokeVersion } from "./karaoke-ready.ts";

test("hasReadyKaraokeVersion", () => {
  expect(hasReadyKaraokeVersion(null)).toBe(false);
  expect(hasReadyKaraokeVersion(undefined)).toBe(false);
  expect(hasReadyKaraokeVersion({ status: "draft", videoFileId: "v" })).toBe(false);
  expect(hasReadyKaraokeVersion({ status: "ready", videoFileId: null })).toBe(false);
  expect(hasReadyKaraokeVersion({ status: "ready", videoFileId: "v" })).toBe(true);
});
