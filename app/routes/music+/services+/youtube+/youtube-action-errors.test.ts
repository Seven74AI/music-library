import { describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { SERVICE_IMPORT_CLIENT_ERROR_MESSAGE } from "#app/utils/error-handlers.server";
import { YouTubeAPIError, YOUTUBE_ERROR_CODES } from "#app/utils/youtube-errors.ts";

vi.mock("#app/utils/auth.server", () => ({
  requireUserId: vi.fn().mockResolvedValue("user-test"),
}));

vi.mock("#app/utils/service-import.server", () => ({
  importTrackDirectly: vi.fn(),
}));

vi.mock("#app/utils/youtube-search.server", () => ({
  searchYouTubeVideos: vi.fn(),
}));

import { searchYouTubeVideos } from "#app/utils/youtube-search.server";
import { action as importAction } from "./import.tsx";

describe("YouTube route action error responses", () => {
  test("import action does not expose YouTube API key configuration text", async () => {
    consoleError.mockImplementation(() => {});
    vi.mocked(searchYouTubeVideos).mockRejectedValue(
      new YouTubeAPIError("YouTube API key is not configured", YOUTUBE_ERROR_CODES.NO_API_KEY),
    );

    const formData = new FormData();
    formData.set("intent", "search");
    formData.set("query", "test query");

    const request = new Request("http://localhost/music/services/youtube/import", {
      method: "POST",
      body: formData,
    });

    const result = await importAction({
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: "/music/services/youtube/import",
    });

    expect(result).toMatchObject({
      data: {
        status: "error",
        message: SERVICE_IMPORT_CLIENT_ERROR_MESSAGE,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/API key/i);
    expect(JSON.stringify(result)).not.toContain("YouTube API key is not configured");
  });

  test("import action maps unknown errors to the service import fallback", async () => {
    consoleError.mockImplementation(() => {});
    vi.mocked(searchYouTubeVideos).mockRejectedValue(
      new Error("upstream socket hang up ECONNRESET"),
    );

    const formData = new FormData();
    formData.set("intent", "search");
    formData.set("query", "test query");

    const request = new Request("http://localhost/music/services/youtube/import", {
      method: "POST",
      body: formData,
    });

    const result = await importAction({
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: "/music/services/youtube/import",
    });

    expect(result).toMatchObject({
      data: {
        status: "error",
        message: SERVICE_IMPORT_CLIENT_ERROR_MESSAGE,
      },
    });
    expect(JSON.stringify(result)).not.toContain("ECONNRESET");
  });
});
