import { describe, expect, test } from "vitest";
import {
  YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE,
  YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE,
  YouTubeAPIError,
  YouTubeQuotaError,
  throwFromYouTubeGoogleApiError,
} from "./youtube-errors";

describe("throwFromYouTubeGoogleApiError", () => {
  test("does not forward upstream Google API message for generic API errors", () => {
    const upstream = "The request cannot be completed because you have exceeded your <quota>.";
    try {
      throwFromYouTubeGoogleApiError({ code: 500, message: upstream }, "playlists");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(YouTubeAPIError);
      expect((error as YouTubeAPIError).message).toBe(YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE);
      expect((error as YouTubeAPIError).message).not.toContain("quota");
      expect((error as YouTubeAPIError).message).not.toBe(upstream);
    }
  });

  test("maps quota in 403 responses to YouTubeQuotaError", () => {
    expect(() =>
      throwFromYouTubeGoogleApiError(
        { code: 403, message: "Daily Limit Exceeded. Quota usage cap hit." },
        "playlistItems",
      ),
    ).toThrow(YouTubeQuotaError);
  });

  test("uses playlist-items client message for unclassified API errors", () => {
    try {
      throwFromYouTubeGoogleApiError(
        { code: 400, message: "Invalid value at 'playlist_id' (TYPE_BYTES)" },
        "playlistItems",
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(YouTubeAPIError);
      expect((error as YouTubeAPIError).message).toBe(YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE);
    }
  });
});
