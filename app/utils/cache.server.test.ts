import { afterEach, describe, expect, test } from "vitest";
import { cache, getAllCacheKeys, lruCache, searchCacheKeys } from "./cache.server.ts";

const keys = {
  plain: "cache-search-plain",
  underscore: "cache-search-under_score",
  percent: "cache-search-per%cent",
  both: "cache-search-mix_%ed",
} as const;

const allKeys = Object.values(keys);

function entry() {
  return {
    metadata: { createdTime: Date.now(), ttl: 60_000 },
    value: { probe: true },
  };
}

async function seed() {
  for (const key of allKeys) {
    const value = entry();
    await cache.set(key, value);
    lruCache.set(key, value);
  }
}

afterEach(async () => {
  for (const key of allKeys) {
    await cache.delete(key);
    lruCache.delete(key);
  }
});

describe("searchCacheKeys", () => {
  test("treats _ and % as literal characters in SQLite and LRU", async () => {
    await seed();

    const underscore = await searchCacheKeys("_", 10_000);
    expect(underscore.sqlite).toEqual(expect.arrayContaining([keys.underscore, keys.both]));
    expect(underscore.sqlite).not.toContain(keys.plain);
    expect(underscore.sqlite).not.toContain(keys.percent);
    expect(underscore.sqlite.every((key) => key.includes("_"))).toBe(true);
    expect(underscore.lru).toEqual(expect.arrayContaining([keys.underscore, keys.both]));
    expect(underscore.lru).not.toContain(keys.plain);
    expect(underscore.lru).not.toContain(keys.percent);
    expect(underscore.lru.every((key) => key.includes("_"))).toBe(true);

    const percent = await searchCacheKeys("%", 10_000);
    expect(percent.sqlite).toEqual(expect.arrayContaining([keys.percent, keys.both]));
    expect(percent.sqlite).not.toContain(keys.plain);
    expect(percent.sqlite).not.toContain(keys.underscore);
    expect(percent.sqlite.every((key) => key.includes("%"))).toBe(true);
    expect(percent.lru).toEqual(expect.arrayContaining([keys.percent, keys.both]));
    expect(percent.lru).not.toContain(keys.plain);
    expect(percent.lru.every((key) => key.includes("%"))).toBe(true);

    const literal = await searchCacheKeys("cache-search-plain", 10_000);
    expect(literal.sqlite).toContain(keys.plain);
    expect(literal.sqlite).not.toContain(keys.underscore);
    expect(literal.lru).toContain(keys.plain);
    expect(literal.lru).not.toContain(keys.underscore);
  });
});

const PREFIX = "cache-admin-limit-389";

function cacheEntry() {
  return {
    metadata: { createdTime: Date.now(), ttl: null as number | null },
    value: "limit-probe",
  };
}

const seeded: Array<string> = [];

function seedLru(key: string) {
  lruCache.set(key, cacheEntry());
  seeded.push(key);
}

afterEach(() => {
  for (const key of seeded) lruCache.delete(key);
  seeded.length = 0;
});

describe("cache admin key limit", () => {
  test("getAllCacheKeys caps the LRU list at the limit without deleting keys", async () => {
    const limitKeys = [`${PREFIX}-a`, `${PREFIX}-b`, `${PREFIX}-c`];
    for (const key of limitKeys) seedLru(key);

    const limited = await getAllCacheKeys(1);

    expect(limited.lru).toHaveLength(1);
    expect(limited.sqlite.length).toBeLessThanOrEqual(1);
    for (const key of limitKeys) {
      expect(lruCache.get(key)?.value).toBe("limit-probe");
    }
  });

  test("searchCacheKeys caps matching LRU keys at the limit", async () => {
    seedLru(`${PREFIX}-a`);
    seedLru(`${PREFIX}-b`);
    // Most recently used, and it must not consume the limit ahead of matches.
    seedLru("unrelated-lru-key-389");

    const limited = await searchCacheKeys(PREFIX, 1);

    expect(limited.lru).toHaveLength(1);
    expect(limited.lru.every((key) => key.includes(PREFIX))).toBe(true);
    expect(limited.sqlite.length).toBeLessThanOrEqual(1);
    expect(lruCache.get(`${PREFIX}-a`)?.value).toBe("limit-probe");
    expect(lruCache.get(`${PREFIX}-b`)?.value).toBe("limit-probe");
    expect(lruCache.get("unrelated-lru-key-389")?.value).toBe("limit-probe");
  });
});
