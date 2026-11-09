/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { getVerifySearchParam, runSensitiveUrlScrub } from "./sensitive-url-scrub.client.ts";
import { SENSITIVE_URL_SESSION_STORAGE_KEY } from "./sensitive-url-query-params.shared.ts";

function setLocation(pathWithQuery: string) {
  const url = new URL(pathWithQuery, "http://localhost");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

afterEach(() => {
  sessionStorage.removeItem(SENSITIVE_URL_SESSION_STORAGE_KEY);
  delete window.__SENSITIVE_PARAMS__;
  setLocation("/");
});

describe("runSensitiveUrlScrub", () => {
  test("strips sensitive query params from the visible URL and preserves verify flow params in storage", () => {
    setLocation("/verify?code=654321&type=onboarding&target=user-1&foo=bar");

    runSensitiveUrlScrub();

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/verify");
    expect(window.location.href).not.toContain("code=");

    expect(window.__SENSITIVE_PARAMS__).toMatchObject({
      code: "654321",
      type: "onboarding",
      target: "user-1",
      foo: "bar",
    });

    const fallbackParams = new URLSearchParams();
    expect(getVerifySearchParam("code", fallbackParams)).toBe("654321");
    expect(getVerifySearchParam("type", fallbackParams)).toBe("onboarding");
    expect(getVerifySearchParam("target", fallbackParams)).toBe("user-1");
  });

  test("does not scrub URLs without sensitive params", () => {
    setLocation("/library?sort=title");

    runSensitiveUrlScrub();

    expect(window.location.search).toBe("?sort=title");
    expect(window.__SENSITIVE_PARAMS__).toBeUndefined();
  });
});
