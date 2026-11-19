import { describe, expect, test } from "vitest";
import { getTheme } from "./theme.server.ts";

function makeRequest(cookie?: string) {
  return new Request("https://example.com", {
    headers: cookie ? { cookie } : {},
  });
}

describe("getTheme", () => {
  test("returns null when there is no Cookie header", () => {
    expect(getTheme(makeRequest())).toBeNull();
  });

  test("returns null when the Cookie header has no en_theme key", () => {
    expect(getTheme(makeRequest("foo=bar"))).toBeNull();
  });

  test("returns dark when en_theme=dark", () => {
    expect(getTheme(makeRequest("en_theme=dark"))).toBe("dark");
  });

  test("returns light when en_theme=light", () => {
    expect(getTheme(makeRequest("en_theme=light"))).toBe("light");
  });
});
