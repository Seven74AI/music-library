import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { requireUserId } from "#app/utils/auth.server";
import { decryptConnectionTokens } from "#app/utils/token-cipher.server.ts";
import { loader } from "./callback";

function readStoredAccessToken(stored: string | null | undefined): string {
  const decoded = JSON.parse(decryptConnectionTokens(stored ?? "")) as { access_token?: string };
  return decoded.access_token ?? "";
}

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

    expect(connA?.tokens?.startsWith("enc1:")).toBe(true);
    expect(connA?.tokens).not.toContain("token-A");
    expect(connA?.tokens).not.toContain("token-B");
    expect(readStoredAccessToken(connA?.tokens)).toBe("token-A");

    expect(connB?.tokens?.startsWith("enc1:")).toBe(true);
    expect(connB?.tokens).not.toContain("token-B");
    expect(readStoredAccessToken(connB?.tokens)).toBe("token-B");

    const events = await prisma.securityEvent.findMany({
      where: { eventType: "service_connected", userId: { in: [userA.id, userB.id] } },
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.metadata ?? "").not.toContain("token-A");
      expect(event.metadata ?? "").not.toContain("token-B");
    }
  });

  test("does not steal a YouTube channel already connected to another user", async () => {
    const userA = await prisma.user.create({ data: createUser() });
    const userB = await prisma.user.create({ data: createUser() });

    vi.mocked(requireUserId).mockResolvedValueOnce(userA.id);
    mockGetTokens.mockResolvedValueOnce({ access_token: "token-A" });
    mockGetYouTubeUserInfo.mockResolvedValueOnce({ id: "channel-shared", email: "", name: "A" });

    await loader(makeArgs() as never);

    vi.mocked(requireUserId).mockResolvedValueOnce(userB.id);
    mockGetTokens.mockResolvedValueOnce({ access_token: "token-B" });
    mockGetYouTubeUserInfo.mockResolvedValueOnce({ id: "channel-shared", email: "", name: "B" });

    const response = await loader(makeArgs() as never);
    expect((response as Response).headers.get("Location")).toContain("already_connected");

    const connA = await prisma.connection.findFirst({
      where: { providerName: "youtube", userId: userA.id },
    });
    const connB = await prisma.connection.findFirst({
      where: { providerName: "youtube", userId: userB.id },
    });

    expect(connA?.tokens?.startsWith("enc1:")).toBe(true);
    expect(connA?.tokens).not.toContain("token-A");
    expect(readStoredAccessToken(connA?.tokens)).toBe("token-A");
    expect(connB).toBeNull();
  });
});
