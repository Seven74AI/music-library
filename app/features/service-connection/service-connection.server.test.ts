import { beforeEach, describe, expect, it, vi } from "vitest";
import { YOUTUBE_SERVICE } from "#app/constants/services";
import {
  decryptConnectionTokens,
  encryptConnectionTokens,
} from "#app/utils/token-cipher.server.ts";

const mockRefreshAccessToken = vi.fn();

vi.mock("#app/utils/db.server", () => ({
  prisma: {
    connection: {
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("#app/utils/youtube-oauth.server", () => ({
  createYouTubeOAuthService: vi.fn(() => ({
    refreshAccessToken: mockRefreshAccessToken,
  })),
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: vi.fn(() => false),
}));

describe("resolveServiceAccessToken", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { shouldMockYouTube } = await import("#app/utils/youtube-mock-utils");
    vi.mocked(shouldMockYouTube).mockReturnValue(false);
  });

  it("returns null when no connection exists", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBeNull();
  });

  it("returns null when connection has no tokens", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBeNull();
  });

  it("returns access_token for a valid non-expired token", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: JSON.stringify({
        access_token: "valid-token",
        expiry_date: Date.now() + 3600_000,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toEqual({ access_token: "valid-token" });
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes expired tokens when a refresh token is available", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: JSON.stringify({
        access_token: "expired-token",
        refresh_token: "refresh-token",
        expiry_date: Date.now() - 1000,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockRefreshAccessToken.mockResolvedValue({
      access_token: "refreshed-token",
      expiry_date: Date.now() + 3600_000,
    });
    vi.mocked(prisma.connection.update).mockResolvedValue({} as never);

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toEqual({ access_token: "refreshed-token" });
    expect(mockRefreshAccessToken).toHaveBeenCalledWith("refresh-token");
    expect(prisma.connection.update).toHaveBeenCalledTimes(1);

    const stored = vi.mocked(prisma.connection.update).mock.calls[0]?.[0].data.tokens;
    expect(typeof stored).toBe("string");
    const sealed = stored as string;
    expect(sealed.startsWith("enc1:")).toBe(true);
    expect(sealed).not.toContain("refreshed-token");
    expect(sealed).not.toContain("refresh-token");
    expect(sealed).not.toContain("expired-token");

    const decoded = JSON.parse(decryptConnectionTokens(sealed)) as {
      access_token: string;
      refresh_token?: string;
    };
    expect(decoded.access_token).toBe("refreshed-token");
    expect(decoded.refresh_token).toBe("refresh-token");
  });

  it("reads a legacy plaintext JSON token and does not rewrite it", async () => {
    const legacy = JSON.stringify({
      access_token: "legacy-plaintext-access-token",
      refresh_token: "legacy-plaintext-refresh-token",
      expiry_date: Date.now() + 3600_000,
    });
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: legacy,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toEqual({ access_token: "legacy-plaintext-access-token" });
    expect(prisma.connection.update).not.toHaveBeenCalled();
  });

  it("returns a usable access token from encrypted connection tokens", async () => {
    const stored = encryptConnectionTokens(
      JSON.stringify({
        access_token: "fake-access-token",
        refresh_token: "fake-refresh-token",
        expiry_date: Date.now() + 3600_000,
      }),
    );
    expect(stored).not.toContain("fake-access-token");
    expect(stored).not.toContain("fake-refresh-token");

    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: stored,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toEqual({ access_token: "fake-access-token" });
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(prisma.connection.update).not.toHaveBeenCalled();
  });

  it("does not log token material when stored ciphertext cannot be decrypted", async () => {
    const { consoleError } = await import("#tests/setup/setup-test-env.ts");
    consoleError.mockImplementation(() => {});

    const stored = encryptConnectionTokens(
      JSON.stringify({
        access_token: "fake-access-token",
        refresh_token: "fake-refresh-token",
        expiry_date: Date.now() + 3600_000,
      }),
    );
    const tamperAt = stored.indexOf(":") + 8;
    const tampered =
      stored.slice(0, tamperAt) +
      (stored[tamperAt] === "A" ? "B" : "A") +
      stored.slice(tamperAt + 1);

    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: tampered,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBeNull();
    const logged = consoleError.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("fake-access-token");
    expect(logged).not.toContain("fake-refresh-token");
  });

  it("returns null when token is expired and no refresh token exists", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: JSON.stringify({
        access_token: "expired-token",
        expiry_date: Date.now() - 1000,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBeNull();
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("returns null when token refresh fails", async () => {
    const { consoleError } = await import("#tests/setup/setup-test-env.ts");
    consoleError.mockImplementation(() => {});

    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: JSON.stringify({
        access_token: "expired-token",
        refresh_token: "refresh-token",
        expiry_date: Date.now() - 1000,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockRefreshAccessToken.mockRejectedValue(new Error("OAuth refresh failed"));

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBeNull();
  });

  it("returns mock token without refresh when YouTube mocks are enabled", async () => {
    const { shouldMockYouTube } = await import("#app/utils/youtube-mock-utils");
    vi.mocked(shouldMockYouTube).mockReturnValue(true);

    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: JSON.stringify({
        access_token: "mock-access-token",
        expiry_date: Date.now() - 1000,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toEqual({ access_token: "mock-access-token" });
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("returns null for unsupported services", async () => {
    const { resolveServiceAccessToken } = await import("./service-connection.server.ts");

    const result = await resolveServiceAccessToken("spotify", "user-1");

    expect(result).toBeNull();
  });
});

describe("hasServiceConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when resolveServiceAccessToken succeeds", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "conn-1",
      providerName: YOUTUBE_SERVICE.NAME,
      providerId: "yt-1",
      userId: "user-1",
      tokens: JSON.stringify({
        access_token: "valid-token",
        expiry_date: Date.now() + 3600_000,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { hasServiceConnection } = await import("./service-connection.server.ts");

    expect(await hasServiceConnection(YOUTUBE_SERVICE.NAME, "user-1")).toBe(true);
  });

  it("returns false when resolveServiceAccessToken returns null", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

    const { hasServiceConnection } = await import("./service-connection.server.ts");

    expect(await hasServiceConnection(YOUTUBE_SERVICE.NAME, "user-1")).toBe(false);
  });
});

describe("disconnectServiceConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a connection is deleted", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.deleteMany).mockResolvedValue({ count: 1 });

    const { disconnectServiceConnection } = await import("./service-connection.server.ts");

    const result = await disconnectServiceConnection(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBe(true);
    expect(prisma.connection.deleteMany).toHaveBeenCalledWith({
      where: {
        providerName: YOUTUBE_SERVICE.NAME,
        userId: "user-1",
      },
    });
  });

  it("returns false when no connection existed", async () => {
    const { prisma } = await import("#app/utils/db.server");
    vi.mocked(prisma.connection.deleteMany).mockResolvedValue({ count: 0 });

    const { disconnectServiceConnection } = await import("./service-connection.server.ts");

    const result = await disconnectServiceConnection(YOUTUBE_SERVICE.NAME, "user-1");

    expect(result).toBe(false);
  });
});
