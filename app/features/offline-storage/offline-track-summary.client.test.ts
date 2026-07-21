import { describe, expect, test } from "vitest";
import {
  getOfflineAudioFormat,
  mimeTypeForAudioFormat,
  offlineSummaryToFullTrack,
} from "./offline-track-summary.client.ts";

describe("offline track summary helpers", () => {
  test("prefers flac when selecting offline audio format", () => {
    expect(
      getOfflineAudioFormat({
        audioFiles: [
          { id: "1", format: "mp3", objectKey: "a.mp3" },
          { id: "2", format: "flac", objectKey: "a.flac" },
        ],
      }),
    ).toBe("flac");
  });

  test("maps audio formats to playback mime types", () => {
    expect(mimeTypeForAudioFormat("flac")).toBe("audio/flac");
    expect(mimeTypeForAudioFormat("mp3")).toBe("audio/mpeg");
  });

  test("converts offline summaries into playable full tracks", () => {
    const track = offlineSummaryToFullTrack({
      trackId: "track-1",
      title: "Offline Song",
      artistId: "artist-1",
      artistName: "Artist",
      duration: 180,
      coverObjectKey: null,
      audioFormat: "flac",
      isPinned: true,
      isQueueCached: false,
      fileSizeBytes: 1000,
      lastAccessedAt: 1,
    });

    expect(track.id).toBe("track-1");
    expect(track.audioFiles?.[0]?.format).toBe("flac");
  });
});
