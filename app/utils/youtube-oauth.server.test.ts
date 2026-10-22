import { describe, expect, test } from "vitest";
import {
  clearOAuthState,
  commitOAuthState,
  generateOAuthState,
  verifyOAuthState,
  youtubeOAuthStateCookie,
} from "./youtube-oauth.server";

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
