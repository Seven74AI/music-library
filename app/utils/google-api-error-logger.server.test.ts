import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import {
  logGoogleApiError,
  logGoogleYouTubeDataApiClientError,
} from "./google-api-error-logger.server.ts";

describe("logGoogleApiError", () => {
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
        data: { refresh_token: "rt-secret", client_secret: "cs-secret" },
      },
    };

    logGoogleYouTubeDataApiClientError("YouTube search API error", gaxiosError);

    expect(consoleError).toHaveBeenCalled();
    const output = loggedOutput();
    expect(output).toContain("403");
    expect(output).not.toContain(sensitiveKey);
    expect(output).not.toContain("config.url");
    expect(output).not.toMatch(/AIzaSy_/);
    expect(output).not.toContain("rt-secret");
    expect(output).not.toContain("cs-secret");
  });

  test("never passes the raw error object to console.error", () => {
    const gaxiosError = { message: "fail", config: { data: { access_token: "tok" } } };
    logGoogleApiError("OAuth failure", gaxiosError);
    for (const call of consoleError.mock.calls) {
      for (const arg of call) {
        expect(arg).not.toBe(gaxiosError);
        if (arg && typeof arg === "object") {
          expect(arg).not.toHaveProperty("config");
        }
      }
    }
  });

  test("uses Error.cause string for detail without logging the Gaxios cause object", () => {
    const wrapped = new Error("Failed to exchange authorization code for tokens", {
      cause: "token exchange failed",
    });
    logGoogleApiError("YouTube OAuth callback error", wrapped);
    const output = loggedOutput();
    expect(output).toContain("token exchange failed");
    for (const call of consoleError.mock.calls) {
      for (const arg of call) {
        expect(arg).not.toHaveProperty("config");
      }
    }
  });
});
