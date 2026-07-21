import { describe, expect, it } from "vitest";
import { pickCoverThumbnailUrl, transformYouTubePlaylistItemToTrack } from "./transformations";
import { type YouTubePlaylistItem } from "./youtube-api";

describe("transformYouTubePlaylistItemToTrack", () => {
  const baseItem: YouTubePlaylistItem = {
    snippet: {
      title: "Test Video",
      resourceId: { videoId: "abc123" },
      publishedAt: "2026-07-01T10:00:00Z", // date added to playlist — NOT a release date
      thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
    },
    contentDetails: {
      videoId: "abc123",
    },
  };

  it("uses contentDetails.videoPublishedAt as releaseDate when present", () => {
    const item = {
      ...baseItem,
      contentDetails: {
        videoId: "abc123",
        videoPublishedAt: "2024-03-15T00:00:00Z",
      },
    };

    const result = transformYouTubePlaylistItemToTrack(item, "service-1", "artist-1");

    expect(result.releaseDate).toEqual(new Date("2024-03-15T00:00:00Z"));
  });

  it("leaves releaseDate null when videoPublishedAt is missing — snippet.publishedAt is the playlist-add date, not a release date", () => {
    const result = transformYouTubePlaylistItemToTrack(baseItem, "service-1", "artist-1");

    expect(result.releaseDate).toBeNull();
  });

  it("leaves duration null — the archive worker backfills it from the audio file", () => {
    const result = transformYouTubePlaylistItemToTrack(baseItem, "service-1", "artist-1");

    expect(result.duration).toBeNull();
  });

  it("prefers the maxres thumbnail as the cover source", () => {
    const item = {
      ...baseItem,
      snippet: {
        ...baseItem.snippet,
        thumbnails: {
          default: { url: "https://example.com/default.jpg" },
          medium: { url: "https://example.com/medium.jpg" },
          maxres: { url: "https://example.com/maxres.jpg" },
        },
      },
    };

    const result = transformYouTubePlaylistItemToTrack(item, "service-1", "artist-1");

    expect(result.thumbnailUrl).toBe("https://example.com/maxres.jpg");
  });
});

describe("pickCoverThumbnailUrl", () => {
  it("prefers maxres (1280x720, 16:9) when available", () => {
    expect(
      pickCoverThumbnailUrl({
        default: { url: "https://example.com/default.jpg" },
        medium: { url: "https://example.com/medium.jpg" },
        high: { url: "https://example.com/high.jpg" },
        standard: { url: "https://example.com/standard.jpg" },
        maxres: { url: "https://example.com/maxres.jpg" },
      }),
    ).toBe("https://example.com/maxres.jpg");
  });

  it("falls back to medium (320x180, 16:9) — never high/standard, which are 4:3 letterboxed", () => {
    expect(
      pickCoverThumbnailUrl({
        default: { url: "https://example.com/default.jpg" },
        medium: { url: "https://example.com/medium.jpg" },
        high: { url: "https://example.com/high.jpg" },
        standard: { url: "https://example.com/standard.jpg" },
      }),
    ).toBe("https://example.com/medium.jpg");
  });

  it("falls back to default when nothing else is available", () => {
    expect(
      pickCoverThumbnailUrl({
        default: { url: "https://example.com/default.jpg" },
      }),
    ).toBe("https://example.com/default.jpg");
  });

  it("returns null when there are no thumbnails", () => {
    expect(pickCoverThumbnailUrl(undefined)).toBeNull();
    expect(pickCoverThumbnailUrl({})).toBeNull();
  });
});
