import { beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";

const { mockChannelsList, mockSetCredentials, mockYouTubeClient, mockShouldMockYouTube } =
  vi.hoisted(() => ({
    mockChannelsList: vi.fn(),
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
        channels: {
          list: mockChannelsList,
        },
      };
    },
  },
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: () => mockShouldMockYouTube(),
}));

const MOCK_YOUTUBE_CHANNEL = {
  id: "mock-youtube-channel",
  email: "",
  name: "Mock YouTube Channel",
};

describe("YouTubeService.getYouTubeUserInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldMockYouTube.mockReturnValue(false);
    consoleError.mockImplementation(() => {});
  });

  test("returns a stable mock channel and does not call Google when mocks are enabled", async () => {
    mockShouldMockYouTube.mockReturnValue(true);
    const { YouTubeService } = await import("./youtube.server");
    const service = new YouTubeService();
    mockYouTubeClient.mockClear();

    const first = await service.getYouTubeUserInfo("mock-access-token");
    const second = await service.getYouTubeUserInfo("another-token");

    expect(first).toEqual(MOCK_YOUTUBE_CHANNEL);
    expect(second).toEqual(MOCK_YOUTUBE_CHANNEL);
    expect(mockChannelsList).not.toHaveBeenCalled();
    expect(mockSetCredentials).not.toHaveBeenCalled();
    expect(mockYouTubeClient).not.toHaveBeenCalled();
  });

  test("calls channels.list and maps the authenticated channel when mocks are disabled", async () => {
    mockChannelsList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "UC-real-channel",
            snippet: { title: "Real Channel" },
          },
        ],
      },
    });

    const { YouTubeService } = await import("./youtube.server");
    const service = new YouTubeService();

    const userInfo = await service.getYouTubeUserInfo("real-access-token");

    expect(mockSetCredentials).toHaveBeenCalledWith({ access_token: "real-access-token" });
    expect(mockChannelsList).toHaveBeenCalledTimes(1);
    expect(mockChannelsList).toHaveBeenCalledWith({
      part: ["snippet"],
      mine: true,
    });
    expect(userInfo).toEqual({
      id: "UC-real-channel",
      email: "",
      name: "Real Channel",
    });
  });
});
