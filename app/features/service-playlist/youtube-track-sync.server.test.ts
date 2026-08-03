import { describe, expect, test } from "vitest";
import { type YouTubePlaylistItem } from "#app/types/youtube-api";
import { createYouTubeTrackSyncProcessor } from "./youtube-track-sync.server";

describe("YouTubeTrackSyncProcessor", () => {
  const trackProcessor = createYouTubeTrackSyncProcessor();

  describe("isUnavailableVideo", () => {
    test("detects deleted video by title pattern", () => {
      const item: YouTubePlaylistItem = {
        snippet: {
          title: "Deleted video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.isUnavailableVideo(item)).toBe(true);
    });

    test("detects private video by title pattern", () => {
      const item: YouTubePlaylistItem = {
        snippet: {
          title: "Private video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.isUnavailableVideo(item)).toBe(true);
    });

    test("detects unavailable video by title pattern", () => {
      const item: YouTubePlaylistItem = {
        snippet: {
          title: "Unavailable video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.isUnavailableVideo(item)).toBe(true);
    });

    test("detects unavailable video by missing video ID", () => {
      const item: YouTubePlaylistItem = {
        snippet: {
          title: "Some Video Title",
          resourceId: {
            videoId: "",
          },
        },
      };

      expect(trackProcessor.isUnavailableVideo(item)).toBe(true);
    });

    test("does not treat missing thumbnail alone as unavailable", () => {
      const item: YouTubePlaylistItem = {
        snippet: {
          title: "Some Video Title",
          resourceId: {
            videoId: "test123",
          },
          thumbnails: {},
        },
      };

      expect(trackProcessor.isUnavailableVideo(item)).toBe(false);
    });

    test("returns false for valid video", () => {
      const item: YouTubePlaylistItem = {
        snippet: {
          title: "Valid Video Title",
          resourceId: {
            videoId: "test123",
          },
          thumbnails: {
            default: {
              url: "https://example.com/thumb.jpg",
            },
          },
        },
      };

      expect(trackProcessor.isUnavailableVideo(item)).toBe(false);
    });
  });

  describe("shouldPreserveTrackData", () => {
    test("preserves data when video is deleted and has original title", () => {
      const existingTrack = {
        title: "Original Video Title",
      };
      const newItem: YouTubePlaylistItem = {
        snippet: {
          title: "Deleted video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.shouldPreserveTrackData(existingTrack, newItem)).toBe(true);
    });

    test('does not preserve data when existing track has "Deleted video" title', () => {
      const existingTrack = {
        title: "Deleted video",
      };
      const newItem: YouTubePlaylistItem = {
        snippet: {
          title: "Deleted video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.shouldPreserveTrackData(existingTrack, newItem)).toBe(false);
    });

    test("preserves data when existing title is not a placeholder even if new title is DELETED VIDEO", () => {
      const existingTrack = {
        title: "Original Video Title",
      };
      const newItem: YouTubePlaylistItem = {
        snippet: {
          title: "DELETED VIDEO",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.shouldPreserveTrackData(existingTrack, newItem)).toBe(true);
    });

    test("does not preserve when existing title is DELETED VIDEO (case-insensitive placeholder)", () => {
      const existingTrack = {
        title: "DELETED VIDEO",
      };
      const newItem: YouTubePlaylistItem = {
        snippet: {
          title: "Deleted video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.shouldPreserveTrackData(existingTrack, newItem)).toBe(false);
    });

    test("does not preserve data when video is not deleted", () => {
      const existingTrack = {
        title: "Original Video Title",
      };
      const newItem: YouTubePlaylistItem = {
        snippet: {
          title: "Updated Video Title",
          resourceId: {
            videoId: "test123",
          },
          thumbnails: {
            default: {
              url: "https://example.com/thumb.jpg",
            },
          },
        },
      };

      expect(trackProcessor.shouldPreserveTrackData(existingTrack, newItem)).toBe(false);
    });

    test("returns false when no existing track", () => {
      const newItem: YouTubePlaylistItem = {
        snippet: {
          title: "Deleted video",
          resourceId: {
            videoId: "test123",
          },
        },
      };

      expect(trackProcessor.shouldPreserveTrackData(null, newItem)).toBe(false);
    });
  });
});
