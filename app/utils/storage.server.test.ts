import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAudioObjectKey, isUnifiedAudioObjectKey, uploadFile } from "./storage.server";

describe("buildAudioObjectKey", () => {
  it("builds a youtube archive key", () => {
    expect(buildAudioObjectKey("youtube", "clxyz123", "mp3")).toBe(
      "audio/tracks/youtube/clxyz123.mp3",
    );
  });

  it("builds a local upload key", () => {
    expect(buildAudioObjectKey("local", "clabc456", "flac")).toBe(
      "audio/tracks/local/clabc456.flac",
    );
  });

  it("normalizes extension (strip dot, lowercase)", () => {
    expect(buildAudioObjectKey("youtube", "track-1", ".MP3")).toBe(
      "audio/tracks/youtube/track-1.mp3",
    );
  });

  it("throws when required params are missing", () => {
    expect(() => buildAudioObjectKey("", "track-1", "mp3")).toThrow();
    expect(() => buildAudioObjectKey("youtube", "", "mp3")).toThrow();
    expect(() => buildAudioObjectKey("youtube", "track-1", "")).toThrow();
  });
});

describe("isUnifiedAudioObjectKey", () => {
  it("returns true for unified keys", () => {
    expect(isUnifiedAudioObjectKey("audio/tracks/youtube/clxyz123.mp3")).toBe(true);
    expect(isUnifiedAudioObjectKey("audio/tracks/local/clabc456.flac")).toBe(true);
  });

  it("returns false for legacy archive keys", () => {
    expect(isUnifiedAudioObjectKey("audio/clxyz123/my-video.mp3")).toBe(false);
  });

  it("returns false for legacy upload keys", () => {
    expect(
      isUnifiedAudioObjectKey("audio/tracks/clabc456/clservice123/mp3/1730000000-fileid.mp3"),
    ).toBe(false);
  });
});

describe("uploadFile mock path", () => {
  const originalMocks = process.env.MOCKS;

  beforeEach(() => {
    process.env.MOCKS = "true";
  });

  afterEach(() => {
    if (originalMocks === undefined) {
      delete process.env.MOCKS;
    } else {
      process.env.MOCKS = originalMocks;
    }
  });

  it("returns the key without uploading when MOCKS=true", async () => {
    const key = "audio/tracks/youtube/track-1.mp3";
    await expect(
      uploadFile({
        file: Buffer.from("fake-audio"),
        key,
        contentType: "audio/mpeg",
      }),
    ).resolves.toBe(key);
  });
});
