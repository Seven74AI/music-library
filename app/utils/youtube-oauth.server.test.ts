import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import {
  clearOAuthState,
  commitOAuthState,
  createYouTubeOAuthService,
  generateOAuthState,
  verifyOAuthState,
  youtubeOAuthStateCookie,
  YouTubeOAuthService,
} from "./youtube-oauth.server";

const {
  mockGetToken,
  mockRefreshAccessToken,
  mockGenerateAuthUrl,
  mockOAuth2Constructor,
  mockShouldMockYouTube,
} = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
  mockGenerateAuthUrl: vi.fn(),
  mockOAuth2Constructor: vi.fn(),
  mockShouldMockYouTube: vi.fn(() => false),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        constructor(...args: unknown[]) {
          mockOAuth2Constructor(...args);
        }
        getToken = mockGetToken;
        setCredentials = vi.fn();
        refreshAccessToken = mockRefreshAccessToken;
        generateAuthUrl = mockGenerateAuthUrl;
      },
    },
  },
}));

vi.mock("#app/utils/youtube-mock-utils", () => ({
  shouldMockYouTube: () => mockShouldMockYouTube(),
}));

const REDIRECT_URI = "http://localhost:3000/music/services/youtube/callback";

function setEnv(
  name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "SITE_URL",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

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

describe("createYouTubeOAuthService", () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldMockYouTube.mockReturnValue(false);
    mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth");
    setEnv("GOOGLE_CLIENT_ID", "");
    setEnv("GOOGLE_CLIENT_SECRET", "");
    setEnv("SITE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    setEnv("GOOGLE_CLIENT_ID", originalClientId);
    setEnv("GOOGLE_CLIENT_SECRET", originalClientSecret);
    setEnv("SITE_URL", originalSiteUrl);
  });

  test("returns the mock callback when YouTube mocks are on and Google credentials are empty", () => {
    mockShouldMockYouTube.mockReturnValue(true);

    const service = createYouTubeOAuthService();
    const url = new URL(service.getAuthUrl("state-1"));

    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code")).toBe("mock-auth-code");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(mockGenerateAuthUrl).not.toHaveBeenCalled();
  });

  test("returns the mock callback when YouTube mocks are on and Google credentials are unset", () => {
    mockShouldMockYouTube.mockReturnValue(true);
    setEnv("GOOGLE_CLIENT_ID", undefined);
    setEnv("GOOGLE_CLIENT_SECRET", undefined);

    const url = new URL(createYouTubeOAuthService().getAuthUrl("state-1"));

    expect(url.searchParams.get("code")).toBe("mock-auth-code");
    expect(mockGenerateAuthUrl).not.toHaveBeenCalled();
  });

  test("keeps provided Google credentials when YouTube mocks are on", () => {
    mockShouldMockYouTube.mockReturnValue(true);
    setEnv("GOOGLE_CLIENT_ID", "provided-client-id");
    setEnv("GOOGLE_CLIENT_SECRET", "provided-client-secret");

    const service = createYouTubeOAuthService();

    expect(mockOAuth2Constructor).toHaveBeenCalledWith(
      "provided-client-id",
      "provided-client-secret",
      REDIRECT_URI,
    );
    expect(new URL(service.getAuthUrl("state-1")).searchParams.get("code")).toBe("mock-auth-code");
  });

  test("requires GOOGLE_CLIENT_ID when YouTube mocks are off", () => {
    expect(() => createYouTubeOAuthService()).toThrow(
      "GOOGLE_CLIENT_ID environment variable is required",
    );
    expect(mockOAuth2Constructor).not.toHaveBeenCalled();
  });

  test("requires GOOGLE_CLIENT_SECRET when YouTube mocks are off", () => {
    setEnv("GOOGLE_CLIENT_ID", "real-client-id");

    expect(() => createYouTubeOAuthService()).toThrow(
      "GOOGLE_CLIENT_SECRET environment variable is required",
    );
    expect(mockOAuth2Constructor).not.toHaveBeenCalled();
  });

  test("uses the real Google auth URL when mocks are off and credentials are set", () => {
    setEnv("GOOGLE_CLIENT_ID", "real-client-id");
    setEnv("GOOGLE_CLIENT_SECRET", "real-client-secret");

    const service = createYouTubeOAuthService();

    expect(mockOAuth2Constructor).toHaveBeenCalledWith(
      "real-client-id",
      "real-client-secret",
      REDIRECT_URI,
    );
    expect(service.getAuthUrl("state-1")).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube",
      ],
      state: "state-1",
      prompt: "consent",
    });
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
    mockShouldMockYouTube.mockReturnValue(false);
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
