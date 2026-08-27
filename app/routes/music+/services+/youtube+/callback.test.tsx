import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { requireUserId } from "#app/utils/auth.server";
import { loader } from "./callback";

vi.mock("#app/utils/auth.server", () => ({
  requireUserId: vi.fn(),
}));

const { mockGetTokens, mockGetYouTubeUserInfo } = vi.hoisted(() => ({
  mockGetTokens: vi.fn(),
  mockGetYouTubeUserInfo: vi.fn(),
}));

vi.mock("#app/utils/youtube-oauth.server", () => ({
  createYouTubeOAuthService: vi.fn(() => ({
    getTokens: mockGetTokens,
  })),
}));

vi.mock("#app/utils/youtube.server", () => ({
  createYouTubeService: vi.fn(() => ({
    getYouTubeUserInfo: mockGetYouTubeUserInfo,
  })),
}));

function makeArgs(code = "test-code") {
  const url = new URL(`http://localhost/music/services/youtube/callback?code=${code}`);
  return {
    request: new Request(url.toString()),
    url,
    params: {},
    context: {},
  };
}

describe("YouTube OAuth callback", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();
  });

  test("each user keeps their own YouTube connection (no cross-user clobbering)", async () => {
    const userA = await prisma.user.create({ data: createUser() });
    const userB = await prisma.user.create({ data: createUser() });

    // User A connects
    vi.mocked(requireUserId).mockResolvedValueOnce(userA.id);
    mockGetTokens.mockResolvedValueOnce({ access_token: "token-A" });
    mockGetYouTubeUserInfo.mockResolvedValueOnce({ id: "channel-A", email: "", name: "A" });

    await loader(makeArgs() as never);

    // User B connects
    vi.mocked(requireUserId).mockResolvedValueOnce(userB.id);
    mockGetTokens.mockResolvedValueOnce({ access_token: "token-B" });
    mockGetYouTubeUserInfo.mockResolvedValueOnce({ id: "channel-B", email: "", name: "B" });

    await loader(makeArgs() as never);

    const connA = await prisma.connection.findFirst({
      where: { providerName: "youtube", userId: userA.id },
    });
    const connB = await prisma.connection.findFirst({
      where: { providerName: "youtube", userId: userB.id },
    });

    // User A must still hold their own token…
    expect(connA?.tokens).toContain("token-A");
    expect(connA?.tokens).not.toContain("token-B");
    // …and user B must have their own connection, not appear disconnected.
    expect(connB?.tokens).toContain("token-B");
  });
});
