import { afterEach, describe, expect, test, vi } from "vitest";
import { cache } from "#app/utils/cache.server.ts";
import { loader } from "./cache_.sqlite.$cacheKey.ts";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireUserWithRole: vi.fn(async () => "admin-user"),
}));

const cacheKey = "search:sqlite-key-page";

const storedEntry = {
  metadata: {
    createdTime: 1_700_000_000_000,
    ttl: 60_000,
    swr: 0,
  },
  value: {
    results: [{ id: "track-1", title: "Stored result" }],
    pagination: { page: 1, pageSize: 20 },
  },
};

describe("SQLite cache key loader", () => {
  afterEach(async () => {
    await cache.delete(cacheKey);
  });

  test("JSON response value is the stored cache entry", async () => {
    await cache.set(cacheKey, storedEntry);
    const before = await cache.get(cacheKey);

    const data = await loader({
      request: new Request(`http://localhost/admin/cache/sqlite/${encodeURIComponent(cacheKey)}`),
      params: { cacheKey },
      context: {},
    } as never);

    // Resource routes respond with Response.json. A Promise stringifies to {}.
    const response = Response.json(data);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as {
      cacheKey: string;
      value: typeof storedEntry;
    };
    expect(body).toMatchObject({
      cacheKey,
      value: storedEntry,
    });
    expect(body.value).toEqual(storedEntry);
    expect(Object.keys(body.value).length).toBeGreaterThan(0);

    const after = await cache.get(cacheKey);
    expect(after).toEqual(before);
    expect(after).toEqual(storedEntry);
  });
});
