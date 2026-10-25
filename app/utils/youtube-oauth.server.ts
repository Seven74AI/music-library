import { randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { createCookie } from "react-router";
import { z } from "zod";
import { getSessionSecret } from "./env.server.ts";
import { shouldMockYouTube } from "./youtube-mock-utils";

// YouTube OAuth scopes
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube",
];

// OAuth configuration schema
export const YouTubeOAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
});

export type YouTubeOAuthConfig = z.infer<typeof YouTubeOAuthConfigSchema>;

/**
 * Service class for handling YouTube OAuth authentication
 * Manages OAuth flow, token exchange, and user authorization
 */
export class YouTubeOAuthService {
  private oauth2Client: InstanceType<typeof google.auth.OAuth2>;
  private config: YouTubeOAuthConfig;

  /**
   * Creates a new YouTubeOAuthService instance
   *
   * @param config - OAuth configuration object
   */
  constructor(config: YouTubeOAuthConfig) {
    this.config = config;
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
  }

  /**
   * Generate the authorization URL for YouTube OAuth
   *
   * @param state - Optional state parameter for OAuth flow
   * @returns The authorization URL
   */
  getAuthUrl(state?: string): string {
    // If YouTube mocking is enabled, return a mock callback URL
    if (shouldMockYouTube()) {
      const mockCallbackUrl = new URL(this.config.redirectUri);
      mockCallbackUrl.searchParams.set("code", "mock-auth-code");
      mockCallbackUrl.searchParams.set("state", state || "mock-state");
      return mockCallbackUrl.toString();
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: YOUTUBE_SCOPES,
      state,
      prompt: "consent", // Force consent to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param code - The authorization code from OAuth callback
   * @returns Promise resolving to token data
   */
  async getTokens(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expiry_date?: number;
  }> {
    // If YouTube mocking is enabled, return mock tokens
    if (shouldMockYouTube()) {
      return {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      if (!tokens.access_token) {
        throw new Error("Google token response omitted access_token");
      }
      return {
        access_token: tokens.access_token,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        ...(tokens.expiry_date ? { expiry_date: tokens.expiry_date } : {}),
      };
    } catch (error) {
      console.error("Error exchanging code for tokens:", error);
      throw new Error("Failed to exchange authorization code for tokens", { cause: error });
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    expiry_date?: number;
  }> {
    // If YouTube mocking is enabled, return mock refreshed tokens
    if (shouldMockYouTube()) {
      return {
        access_token: "mock-refreshed-access-token",
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };
    }

    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (!credentials.access_token) {
        throw new Error("Google token refresh omitted access_token");
      }
      return {
        access_token: credentials.access_token,
        ...(credentials.expiry_date ? { expiry_date: credentials.expiry_date } : {}),
      };
    } catch (error) {
      console.error("Error refreshing access token:", error);
      throw new Error("Failed to refresh access token", { cause: error });
    }
  }

  /**
   * Set credentials for API calls
   */
  setCredentials(tokens: { access_token?: string; refresh_token?: string; expiry_date?: number }) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * Get the OAuth2 client instance
   */
  getOAuth2Client() {
    return this.oauth2Client;
  }
}

/**
 * Factory function to create a YouTubeOAuthService instance.
 * Google client credentials are required for the real OAuth flow.
 * When YouTube mocks are on they are optional, so mock connect can build
 * the callback URL without a Google client. Production (mocks off) still
 * refuses to start OAuth without both values.
 *
 * @returns YouTubeOAuthService instance
 * @throws Error if required environment variables are missing and mocks are off
 */
export function createYouTubeOAuthService(): YouTubeOAuthService {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

  // shouldMockYouTube() already short-circuits getAuthUrl and getTokens.
  // Skip the credential gate only in that case so the mock callback can be built.
  if (!shouldMockYouTube()) {
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID environment variable is required");
    }
    if (!clientSecret) {
      throw new Error("GOOGLE_CLIENT_SECRET environment variable is required");
    }
  }

  const config = YouTubeOAuthConfigSchema.parse({
    clientId,
    clientSecret,
    redirectUri: `${process.env.SITE_URL || "http://localhost:3000"}/music/services/youtube/callback`,
  });

  return new YouTubeOAuthService(config);
}

/**
 * Validate YouTube tokens
 */
export async function validateYouTubeTokens(tokens: {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}): Promise<boolean> {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({
      version: "v3",
      auth: oauth2Client,
    });

    // Test the token by making a simple API call
    await youtube.channels.list({
      part: ["id"],
      mine: true,
    });

    return true;
  } catch (error) {
    console.error("YouTube token validation failed:", error);
    return false;
  }
}

export const YOUTUBE_OAUTH_STATE_COOKIE_NAME = "en_youtube_oauth_state";

/**
 * Signed, httpOnly cookie that carries the one-time OAuth `state` value between
 * the auth page and the callback. The state is an unguessable random value, so
 * this cookie is the server-side secret that makes the OAuth handshake
 * CSRF-proof. It must stay `lax` — Google redirects back with a cross-site
 * top-level GET, which `strict` would drop.
 */
export const youtubeOAuthStateCookie = createCookie(YOUTUBE_OAUTH_STATE_COOKIE_NAME, {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  maxAge: 60 * 10, // 10 minutes — OAuth handshakes are short-lived
  secure: process.env.NODE_ENV === "production",
  secrets: getSessionSecret(),
});

/** Generates a cryptographically random one-time OAuth state value. */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** Serializes the OAuth state cookie for the outgoing redirect to Google. */
export async function commitOAuthState(state: string): Promise<string> {
  return youtubeOAuthStateCookie.serialize(state);
}

/** Clears the OAuth state cookie (one-time use). */
export async function clearOAuthState(): Promise<string> {
  return youtubeOAuthStateCookie.serialize("", { maxAge: 0 });
}

/**
 * Verifies the `state` query param against the value stored in the OAuth state
 * cookie, using a constant-time comparison. Returns false when either side is
 * missing or the values differ, which aborts the handshake (CSRF protection).
 */
export async function verifyOAuthState(request: Request, state: string | null): Promise<boolean> {
  if (!state) return false;
  const expected = await youtubeOAuthStateCookie.parse(request.headers.get("Cookie"));
  if (typeof expected !== "string" || expected.length === 0) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(state);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
