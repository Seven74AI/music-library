import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { logGoogleYouTubeDataApiClientError } from "./youtube-oauth.server.ts";

const { mockSearchList, mockVideosList, mockShouldMockYouTube } = vi.hoisted(() => ({
  mockSearchList: vi.fn(),
  mockVideosList: vi.fn(),
  mockShouldMockYouTube: vi.fn(() => false),
}));

vi.mock("googleapis", () => ({
  google: {
    youtube: () => ({
      search: { list: mockSearchList },
      videos: { list: mockVideosList },
    }),
  },
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: () => mockShouldMockYouTube(),
}));

describe("logGoogleYouTubeDataApiClientError", () => {
  beforeEach(() => {
    consoleError.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function loggedOutput(): string {
    return consoleError.mock.calls
      .flat()
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join(" ");
  }

  test("logs HTTP status and message without the API key from Gaxios config", () => {
    const sensitiveKey = "AIzaSy_SUPER_SECRET_YOUTUBE_KEY";
    const gaxiosError = {
      name: "Error",
      message: `Request failed with status code 403`,
      code: "ERR_BAD_REQUEST",
      response: {
        status: 403,
        data: { error: { message: "The request is missing a valid API key." } },
      },
      config: {
        url: `https://youtube.googleapis.com/youtube/v3/search?part=snippet&q=test&key=${sensitiveKey}`,
        params: { key: sensitiveKey, part: "snippet", q: "test" },
        headers: { Authorization: `Bearer ${sensitiveKey}` },
      },
    };

    logGoogleYouTubeDataApiClientError("YouTube search API error", gaxiosError);

    expect(consoleError).toHaveBeenCalled();
    const output = loggedOutput();
    expect(output).toContain("403");
    expect(output).not.toContain(sensitiveKey);
    expect(output).not.toContain("config.url");
    expect(output).not.toMatch(/AIzaSy_/);
  });
});

describe("searchYouTubeVideos error logging", () => {
  const originalApiKey = process.env.YOUTUBE_API_KEY;

  beforeEach(() => {
    consoleError.mockImplementation(() => {});
    mockShouldMockYouTube.mockReturnValue(false);
    process.env.YOUTUBE_API_KEY = "test-youtube-api-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = originalApiKey;
    }
  });

  test("does not log the raw Gaxios error or API key when search.list fails", async () => {
    const leakedKey = "AIzaSy_LEAKED_FROM_SEARCH";
    process.env.YOUTUBE_API_KEY = leakedKey;
    mockSearchList.mockRejectedValue({
      message: "Quota exceeded",
      response: { status: 403 },
      config: {
        url: `https://youtube.googleapis.com/youtube/v3/search?key=${leakedKey}`,
        params: { key: leakedKey },
      },
    });

    const { searchYouTubeVideos } = await import("./youtube-search.server.ts");
    await searchYouTubeVideos("test query").catch(() => {});

    expect(consoleError).toHaveBeenCalled();
    const output = consoleError.mock.calls
      .flat()
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join(" ");
    expect(output).toContain("403");
    expect(output).not.toContain(leakedKey);
  });
});
