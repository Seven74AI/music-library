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

vi.mock("#app/features/service-playlist/orphaned-match-confirm.server", async (orig) => ({
  ...(await orig<typeof import("#app/features/service-playlist/orphaned-match-confirm.server")>()),
  confirmOrphanedMatches: vi.fn(),
}));

vi.mock("#app/utils/youtube-search.server", () => ({
  searchYouTubeVideos: vi.fn(),
}));

import { YOUTUBE_PLAYLIST_DETAIL_INTENTS } from "#app/types/youtube-intents.ts";
import { confirmOrphanedMatches } from "#app/features/service-playlist/orphaned-match-confirm.server";
import { searchYouTubeVideos } from "#app/utils/youtube-search.server";
import { action as importAction } from "./import.tsx";
import { action as playlistAction } from "./playlist.$id.tsx";

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

  test("confirm-deleted-match returns a non-400 error when confirm fails", async () => {
    consoleError.mockImplementation(() => {});
    const formData = new FormData();
    formData.set("intent", YOUTUBE_PLAYLIST_DETAIL_INTENTS.CONFIRM_DELETED_MATCH);
    formData.set("matches", JSON.stringify([{ action: "new", position: 1, deletedItemId: "" }]));
    const run = () => {
      const request = new Request("http://localhost/music/services/youtube/playlist/p1", {
        method: "POST",
        body: formData,
      });
      return playlistAction({
        request,
        params: { id: "p1" },
        context: {} as never,
        url: new URL(request.url),
        pattern: "/music/services/youtube/playlist/:id",
      });
    };

    vi.mocked(confirmOrphanedMatches).mockResolvedValueOnce({
      success: false,
      processedCount: 0,
      message: "boom",
      error: "boom",
    });
    const failed = (await run()) as {
      init?: { status?: number } | null;
      data: unknown;
    };
    expect(failed.init?.status).not.toBe(400);
    expect(failed.data).toMatchObject({ status: "error" });
    // "" deletedItemId must not 400 the parse step.
    expect(confirmOrphanedMatches).toHaveBeenCalledWith(
      "p1",
      [{ action: "new", position: 1, deletedItemId: undefined }],
      "user-test",
    );

    vi.mocked(confirmOrphanedMatches).mockRejectedValueOnce(new Error("db down"));
    const thrown = (await run()) as { init?: { status?: number } | null };
    expect(thrown.init?.status).not.toBe(400);
  });

  test("confirm-deleted-match maps each failure case to its status (400/403/404/500)", async () => {
    consoleError.mockImplementation(() => {});
    const run = () => {
      const formData = new FormData();
      formData.set("intent", YOUTUBE_PLAYLIST_DETAIL_INTENTS.CONFIRM_DELETED_MATCH);
      formData.set("matches", JSON.stringify([{ action: "new", position: 1 }]));
      const request = new Request("http://localhost/music/services/youtube/playlist/p1", {
        method: "POST",
        body: formData,
      });
      return playlistAction({
        request,
        params: { id: "p1" },
        context: {} as never,
        url: new URL(request.url),
        pattern: "/music/services/youtube/playlist/:id",
      }) as Promise<{ init?: { status?: number } | null; data: unknown }>;
    };

    const cases: Array<{
      name: string;
      status: 400 | 403 | 404 | 500;
      message: string;
      error: string | undefined;
    }> = [
      {
        name: "duplicate selections",
        status: 400,
        message: "Each orphaned track can only be matched to one deleted video.",
        error: "Duplicate track selections: cuid1",
      },
      {
        name: "not a member",
        status: 403,
        message: "Track is not a member of this playlist: t1",
        error: "Track is not a member of this playlist: t1",
      },
      {
        name: "playlist not found",
        status: 404,
        message: "Playlist not found or access denied",
        error: "Playlist not found or access denied",
      },
      {
        name: "service missing",
        status: 500,
        message: "Service not found for playlist",
        error: undefined,
      },
      {
        name: "generic infra",
        status: 500,
        message: "Failed to process matches. No changes were made. Please try again.",
        error: undefined,
      },
    ];
    for (const c of cases) {
      vi.mocked(confirmOrphanedMatches).mockResolvedValueOnce({
        success: false,
        processedCount: 0,
        message: c.message,
        error: c.error,
        status: c.status,
      });
      const res = await run();
      expect(res.init?.status, c.name).toBe(c.status);
      // Body uses the friendly `message`, never the internal `error`.
      expect(res.data, c.name).toEqual({ status: "error", message: c.message });
    }
  });
});
