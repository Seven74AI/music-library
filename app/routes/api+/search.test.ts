import { describe, expect, test, vi, beforeEach } from "vitest";
import { searchWithCache } from "#app/utils/search-cache.server.ts";
import { loader } from "./search.tsx";

vi.mock("#app/utils/search-cache.server.ts", () => ({
  searchWithCache: vi.fn(),
}));

vi.mock("#app/utils/auth.server.ts", () => ({
  getUserId: vi.fn().mockResolvedValue(null),
}));

function makeRequest(url: string) {
  return { request: new Request(url), url: new URL(url) };
}

describe("search API loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 400 with results shape when query parameter is missing", async () => {
    const response = await loader({
      ...makeRequest("http://localhost/api/search"),
    } as never);

    expect(response.status).toBe(400);
    expect(searchWithCache).not.toHaveBeenCalled();
    const body = (await response.json()) as {
      error: string;
      results: unknown[];
      pagination: { limit: number; hasNext: boolean; nextCursor: null };
    };
    expect(body.error).toBe("Invalid search parameters");
    expect(body.results).toEqual([]);
    expect(body.pagination).toEqual({ limit: 20, hasNext: false, nextCursor: null });
  });

  test("returns 400 with results shape when limit is invalid", async () => {
    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=test&limit=invalid"),
    } as never);

    expect(response.status).toBe(400);
    expect(searchWithCache).not.toHaveBeenCalled();
    const body = (await response.json()) as { results: unknown[]; pagination: unknown };
    expect(body.results).toEqual([]);
    expect(body.pagination).toBeDefined();
  });

  test("returns empty results for punctuation-only query without calling search as crash", async () => {
    vi.mocked(searchWithCache).mockResolvedValue({
      results: [],
      pagination: { limit: 20, hasNext: false, nextCursor: null },
    });

    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=-"),
    } as never);

    expect(response.status).toBe(200);
    expect(searchWithCache).toHaveBeenCalledWith("-", 20, undefined, "all", true, undefined);
    const body = await response.json();
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("pagination");
  });

  test("returns empty SearchResponse shape on search failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(searchWithCache).mockRejectedValue(new Error("MATCH syntax error"));

    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=test"),
    } as never);

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: string;
      results: unknown[];
      pagination: { limit: number };
    };
    expect(body.error).toBe("Failed to perform search");
    expect(body.results).toEqual([]);
    expect(body.pagination.limit).toBe(20);
    consoleError.mockRestore();
  });

  test("returns search results for valid parameters", async () => {
    vi.mocked(searchWithCache).mockResolvedValue({
      results: [],
      pagination: { limit: 20, hasNext: false, nextCursor: null },
    });

    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=test"),
    } as never);

    expect(response.status).toBe(200);
    expect(searchWithCache).toHaveBeenCalledWith("test", 20, undefined, "all", true, undefined);
    const body = await response.json();
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("pagination");
  });
});
