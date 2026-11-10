import { describe, expect, test, vi, beforeEach } from "vitest";
import { YOUTUBE_SERVICE } from "#app/constants/services";
import { type YouTubePlaylist } from "#app/types/youtube-api";
import { createYouTubePlaylistProvider } from "./youtube-playlist-provider.server";

vi.mock("#app/utils/youtube.server", () => ({
  createYouTubeService: vi.fn(() => ({
    getPlaylistItems: vi.fn(),
    getPlaylist: vi.fn(),
    getUserPlaylists: vi.fn(),
    checkVideosExist: vi.fn().mockResolvedValue(new Set()),
  })),
}));

describe("YouTubePlaylistProvider - fetch and normalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("supportsService returns true only for youtube", () => {
    const provider = createYouTubePlaylistProvider();

    expect(provider.supportsService(YOUTUBE_SERVICE.NAME)).toBe(true);
    expect(provider.supportsService("spotify")).toBe(false);
  });

  test("normalizePlaylistData maps YouTube playlist fields", () => {
    const provider = createYouTubePlaylistProvider();
    const rawPlaylist: YouTubePlaylist = {
      id: "PLexternal123",
      snippet: {
        title: "Summer Hits",
        description: "Best songs",
        channelId: "channel1",
        channelTitle: "My Channel",
        thumbnails: {
          medium: { url: "https://example.com/playlist.jpg" },
        },
      },
      contentDetails: {
        itemCount: 42,
      },
    };

    const result = provider.normalizePlaylistData(rawPlaylist, "service-id", "user-id");

    expect(result).toEqual({
      title: "Summer Hits",
      description: "Best songs",
      externalId: "PLexternal123",
      itemCount: 42,
      channelId: "channel1",
      channelTitle: "My Channel",
      thumbnailUrl: "https://example.com/playlist.jpg",
    });
  });
});
