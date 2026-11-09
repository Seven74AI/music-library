import { beforeEach, describe, expect, test, vi } from "vitest";
import { ensureInstance } from "litefs-js/remix";
import { action, loader } from "./cache.tsx";
import { loader as sqliteLoader } from "./cache_.sqlite.$cacheKey.tsx";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireUserWithRole: vi.fn(async () => "admin-user"),
}));

vi.mock("#app/utils/cache.server.ts", () => ({
  cache: { delete: vi.fn() },
  lruCache: { delete: vi.fn() },
  getAllCacheKeys: vi.fn(async () => ({ sqlite: [], lru: [] })),
  searchCacheKeys: vi.fn(async () => ({ sqlite: [], lru: [] })),
}));

const instances = { "5ef6ddf5": "sjc", abc12345: "iad" };

vi.mock("#app/utils/litefs.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/litefs.server.ts")>();
  return {
    ...actual,
    getAllInstances: vi.fn(async () => instances),
    getInstanceInfo: vi.fn(async () => ({
      currentInstance: "5ef6ddf5",
      primaryInstance: "5ef6ddf5",
      currentIsPrimary: true,
    })),
  };
});

vi.mock("litefs-js/remix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("litefs-js/remix")>();
  return {
    ...actual,
    ensureInstance: vi.fn(async () => true as const),
  };
});

describe("admin cache routes fly-replay instance allowlist", () => {
  beforeEach(() => {
    vi.mocked(ensureInstance).mockClear();
  });

  test("cache loader rejects forged instance query param", async () => {
    await expect(
      loader({
        request: new Request("http://localhost/admin/cache?instance=x%3Bapp%3Dother-app"),
        params: {},
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
    expect(ensureInstance).not.toHaveBeenCalled();
  });

  test("cache action rejects forged instance form field", async () => {
    const body = new URLSearchParams({
      cacheKey: "k",
      type: "lru",
      instance: "x;app=other-app",
    });
    await expect(
      action({
        request: new Request("http://localhost/admin/cache", {
          method: "POST",
          body,
        }),
        params: {},
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
    expect(ensureInstance).not.toHaveBeenCalled();
  });

  test("cache loader still calls ensureInstance for allowlisted instance", async () => {
    vi.mocked(ensureInstance).mockResolvedValueOnce(true);

    await loader({
      request: new Request("http://localhost/admin/cache?instance=abc12345"),
      params: {},
      context: {},
    } as never);

    expect(ensureInstance).toHaveBeenCalledWith("abc12345");
  });

  test("sqlite cache detail loader rejects forged instance", async () => {
    await expect(
      sqliteLoader({
        request: new Request(
          "http://localhost/admin/cache/sqlite/some-key?instance=x%3Bapp%3Dother-app",
        ),
        params: { cacheKey: "some-key" },
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
    expect(ensureInstance).not.toHaveBeenCalled();
  });
});
