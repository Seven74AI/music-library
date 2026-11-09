import { afterEach, describe, expect, test, vi } from "vitest";
import { createHttpsUpgradeMiddleware } from "./https-upgrade-middleware";

describe("HTTPS upgrade middleware", () => {
  const originalSiteUrl = process.env.SITE_URL;

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
  });

  test("does not redirect off-origin when client supplies X-Forwarded-Proto http", () => {
    process.env.SITE_URL = "https://music.example.com";
    const middleware = createHttpsUpgradeMiddleware();
    const req = {
      method: "GET",
      originalUrl: "/library",
      get: (name: string) => {
        if (name === "X-Forwarded-Proto") return "http";
        if (name === "X-Forwarded-Host") return "evil.example";
        return undefined;
      },
    };
    const res = { redirect: vi.fn() };
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test("redirects to SITE_URL host when Fly-Forwarded-Proto is http", () => {
    process.env.SITE_URL = "https://music.example.com";
    const middleware = createHttpsUpgradeMiddleware();
    const req = {
      method: "GET",
      originalUrl: "/library?q=1",
      get: (name: string) => {
        if (name === "Fly-Forwarded-Proto") return "http";
        if (name === "X-Forwarded-Host") return "evil.example";
        return undefined;
      },
    };
    const res = { redirect: vi.fn() };
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(res.redirect).toHaveBeenCalledWith(302, "https://music.example.com/library?q=1");
    expect(next).not.toHaveBeenCalled();
  });
});
