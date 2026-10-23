import { beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import {
  clearOAuthState,
  commitOAuthState,
  generateOAuthState,
  verifyOAuthState,
  youtubeOAuthStateCookie,
  YouTubeOAuthService,
} from "./youtube-oauth.server";

const { mockGetToken, mockRefreshAccessToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        getToken = mockGetToken;
        setCredentials = vi.fn();
        refreshAccessToken = mockRefreshAccessToken;
      },
    },
  },
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: () => false,
}));

/** Builds a Request carrying the OAuth state cookie (as a request `Cookie` header). */
async function makeRequest(state: string | null): Promise<Request> {
  const headers = new Headers();
  if (state !== null) {
    const setCookie = await commitOAuthState(state);
    // A Set-Cookie header is `name=value; Path=/; ...`; the request Cookie
    // header only needs the leading `name=value` segment.
    const cookieValue = setCookie.split(";")[0];
    if (cookieValue) {
      headers.set("Cookie", cookieValue);
    }
  }
  return new Request("http://localhost/music/services/youtube/callback", { headers });
}

describe("generateOAuthState", () => {
  test("produces unique, non-empty base64url values", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();

    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });
});

describe("verifyOAuthState", () => {
  test("accepts a matching state round-trip", async () => {
    const state = generateOAuthState();
    const request = await makeRequest(state);

    await expect(verifyOAuthState(request, state)).resolves.toBe(true);
  });

  test("rejects a mismatched state", async () => {
    const request = await makeRequest(generateOAuthState());

    await expect(verifyOAuthState(request, "attacker-controlled-value")).resolves.toBe(false);
  });

  test("rejects a missing state query param", async () => {
    const request = await makeRequest(generateOAuthState());

    await expect(verifyOAuthState(request, null)).resolves.toBe(false);
  });

  test("rejects a missing state cookie", async () => {
    const request = await makeRequest(null);

    await expect(verifyOAuthState(request, generateOAuthState())).resolves.toBe(false);
  });
});

describe("clearOAuthState", () => {
  test("serializes an expired cookie for the state cookie name", async () => {
    const cleared = await clearOAuthState();

    expect(cleared.startsWith(`${youtubeOAuthStateCookie.name}=`)).toBe(true);
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("YouTubeOAuthService token exchange", () => {
  const config = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/music/services/youtube/callback",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError.mockImplementation(() => {});
  });

  test("getTokens fails loudly when Google omits access_token", async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });

    const service = new YouTubeOAuthService(config);
    const error = await service.getTokens("mock-code").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Failed to exchange authorization code for tokens");
    expect((error as Error).cause).toMatchObject({
      message: "Google token response omitted access_token",
    });
  });

  test("refreshAccessToken fails loudly when Google omits access_token", async () => {
    mockRefreshAccessToken.mockResolvedValue({ credentials: {} });

    const service = new YouTubeOAuthService(config);
    const error = await service.refreshAccessToken("mock-refresh").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Failed to refresh access token");
    expect((error as Error).cause).toMatchObject({
      message: "Google token refresh omitted access_token",
    });
  });
});
