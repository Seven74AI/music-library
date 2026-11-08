import { afterEach, describe, expect, test } from "vitest";
import { getDomainUrl } from "./misc.tsx";

describe("getDomainUrl", () => {
  const originalSiteUrl = process.env.SITE_URL;

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
  });

  test("prefers SITE_URL over client-influenced forwarded host headers", () => {
    process.env.SITE_URL = "https://music.example.com";
    const request = new Request("https://evil.example/reset-password", {
      headers: {
        host: "evil.example",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(getDomainUrl(request)).toBe("https://music.example.com");
    expect(new URL(getDomainUrl(request)).hostname).toBe("music.example.com");
  });

  test("falls back to request host when SITE_URL is unset", () => {
    delete process.env.SITE_URL;
    const request = new Request("http://localhost:3000/forgot-password", {
      headers: { host: "localhost:3000" },
    });

    expect(getDomainUrl(request)).toBe("http://localhost:3000");
  });
});
