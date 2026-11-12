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

  test("does not self-fetch when X-Healthcheck header is set", async () => {
    const response = await loader({
      request: new Request("http://127.0.0.1:3000/resources/healthcheck", {
        headers: { "X-Healthcheck": "true" },
      }),
    } as never);

    expect(response.status).toBe(200);
    const headCalls = vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === "HEAD");
    expect(headCalls).toHaveLength(0);
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

  test("self-fetch targets loopback PORT, not SITE_URL, even when SITE_URL is set", async () => {
    const originalPort = process.env.PORT;
    process.env.SITE_URL = "https://public.example.invalid";
    process.env.PORT = "4321";
    try {
      const response = await loader({
        request: new Request("https://public.example.invalid/resources/healthcheck"),
      } as never);

      expect(response.status).toBe(200);
      const headCalls = vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "HEAD");
      expect(headCalls).toHaveLength(1);
      expect(headCalls[0]![0]).toBe("http://127.0.0.1:4321/resources/healthcheck");
      expect(headCalls[0]![1]?.headers).toEqual({ "X-Healthcheck": "true" });
    } finally {
      if (originalPort === undefined) delete process.env.PORT;
      else process.env.PORT = originalPort;
    }
  });

  test("returns 200 with an unreachable SITE_URL because it never contacts it", async () => {
    process.env.SITE_URL = "http://127.0.0.1:1";
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith("http://127.0.0.1:1/")) throw new TypeError("bad port");
      return new Response(null, { status: 200 });
    });
    const response = await loader({
      request: new Request("http://127.0.0.1:3000/resources/healthcheck"),
    } as never);
    expect(response.status).toBe(200);
  });

  test("returns 500 when the loopback self-fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 502 }));
    const response = await loader({
      request: new Request("http://127.0.0.1:3000/resources/healthcheck"),
    } as never);
    expect(response.status).toBe(500);
  });
});
