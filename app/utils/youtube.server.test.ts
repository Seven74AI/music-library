import { beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE, YouTubeAPIError } from "./youtube-errors";

const {
  mockPlaylistsList,
  mockPlaylistItemsList,
  mockSetCredentials,
  mockYouTubeClient,
  mockShouldMockYouTube,
} = vi.hoisted(() => ({
  mockPlaylistsList: vi.fn(),
  mockPlaylistItemsList: vi.fn(),
  mockSetCredentials: vi.fn(),
  mockYouTubeClient: vi.fn(),
  mockShouldMockYouTube: vi.fn(() => false),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = mockSetCredentials;
      },
    },
    youtube: (...args: unknown[]) => {
      mockYouTubeClient(...args);
      return {
        playlists: {
          list: mockPlaylistsList,
        },
        playlistItems: {
          list: mockPlaylistItemsList,
        },
      };
    },
  },
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: () => mockShouldMockYouTube(),
}));

vi.mock("#app/utils/validation", () => ({
  validateYouTubeAPIResponse: (data: unknown) => data,
}));

describe("YouTubeService playlist API errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldMockYouTube.mockReturnValue(false);
    consoleError.mockImplementation(() => {});
  });

  test("getUserPlaylists throws client-safe message when Google returns infra text", async () => {
    const upstream = "Invalid Credentials: oauth token revoked by user";
    mockPlaylistsList.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            code: 500,
            message: upstream,
          },
        },
      },
    });

    const { YouTubeService } = await import("./youtube.server");
    const service = new YouTubeService();

    let caught: unknown;
    try {
      await service.getUserPlaylists("token");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YouTubeAPIError);
    expect((caught as YouTubeAPIError).message).toBe(YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE);
    expect((caught as YouTubeAPIError).message).not.toBe(upstream);
  });

  test("getPlaylistItems does not surface raw Error.message from transport failures", async () => {
    const prismaLeak = "Invalid `prisma.playlist.findMany()` invocation";
    mockPlaylistItemsList.mockRejectedValueOnce(new Error(prismaLeak));

    const { YouTubeService } = await import("./youtube.server");
    const service = new YouTubeService();

    let caught: unknown;
    try {
      await service.getPlaylistItems("PLtest", "token");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(YouTubeAPIError);
    expect((caught as YouTubeAPIError).message).not.toContain("prisma");
    expect((caught as YouTubeAPIError).message).not.toBe(prismaLeak);
  });
});
