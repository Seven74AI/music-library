import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { loader } from "./healthcheck.tsx";

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
    },
  },
}));

describe("healthcheck loader", () => {
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    process.env.SITE_URL = "http://127.0.0.1:3000";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
    vi.restoreAllMocks();
  });

  test("self-HEAD uses trusted loopback origin, not forwarded host", async () => {
    await loader({
      request: new Request("http://evil.internal/resources/healthcheck", {
        headers: {
          "X-Forwarded-Host": "//169.254.169.254",
          host: "//169.254.169.254",
        },
      }),
    } as never);

    const [url] = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === "HEAD") ?? [];
    expect(url).toBe("http://127.0.0.1:3000/resources/healthcheck");
  });
});
