import { describe, expect, test } from "vitest";
import { selectBestAudioFile } from "./audio-format.ts";

describe("selectBestAudioFile", () => {
  test("prefers higher-priority formats (FLAC over MP3)", () => {
    const files = [
      { id: "1", format: "mp3" },
      { id: "2", format: "flac" },
    ];

    expect(selectBestAudioFile(files)).toEqual({ id: "2", format: "flac" });
  });

  test("follows Preferred Audio Format order", () => {
    const files = [
      { id: "1", format: "webm" },
      { id: "2", format: "aac" },
      { id: "3", format: "ogg" },
      { id: "4", format: "m4a" },
      { id: "5", format: "wav" },
    ];

    expect(selectBestAudioFile(files)).toEqual({ id: "5", format: "wav" });
  });

  test("returns null for an empty list", () => {
    expect(selectBestAudioFile([])).toBeNull();
  });

  test("matches formats case-insensitively (uppercase MP3 matches priority list)", () => {
    const files = [
      { id: "1", format: "MP3" },
      { id: "2", format: "webm" },
    ];

    expect(selectBestAudioFile(files)).toEqual({ id: "1", format: "MP3" });
  });

  test("falls back to the first file when no priority format matches", () => {
    const files = [
      { id: "1", format: "opus" },
      { id: "2", format: "aiff" },
    ];

    expect(selectBestAudioFile(files)).toEqual({ id: "1", format: "opus" });
  });
});
