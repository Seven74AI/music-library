import { beforeEach, describe, expect, test, vi } from "vitest";
import { consoleWarn } from "#tests/setup/setup-test-env.ts";

const mockVideosList = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = vi.fn();
      },
    },
    youtube: vi.fn(() => ({
      videos: {
        list: mockVideosList,
      },
    })),
  },
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: () => false,
}));

vi.mock("#app/utils/validation", () => ({
  validateYouTubeAPIResponse: (_data: unknown, _schema: unknown) => _data,
}));

describe("YouTubeService.checkVideosExist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarn.mockImplementation(() => {});
  });

  test("batches ids and returns only videos present in the API response", async () => {
    const { YouTubeService } = await import("./youtube.server");
    const service = new YouTubeService();

    mockVideosList.mockResolvedValueOnce({
      data: {
        items: [{ id: "aaaaaaaaaa1" }, { id: "aaaaaaaaaa3" }],
      },
    });

    const existing = await service.checkVideosExist(
      ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3", "aaaaaaaaaa1"],
      "oauth-token",
    );

    expect(mockVideosList).toHaveBeenCalledWith({
      part: ["id"],
      id: ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3"],
    });
    expect(existing).toEqual(new Set(["aaaaaaaaaa1", "aaaaaaaaaa3"]));
  });

  test("returns empty set when given no ids", async () => {
    const { YouTubeService } = await import("./youtube.server");
    const service = new YouTubeService();

    await expect(service.checkVideosExist([], "token")).resolves.toEqual(new Set());
    expect(mockVideosList).not.toHaveBeenCalled();
  });
});
