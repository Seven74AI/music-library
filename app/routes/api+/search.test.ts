import { describe, expect, test, vi, beforeEach } from "vitest";
import { searchWithCache } from "#app/utils/search-cache.server.ts";
import { loader } from "./search.tsx";

vi.mock("#app/utils/search-cache.server.ts", () => ({
  searchWithCache: vi.fn(),
}));

vi.mock("#app/utils/auth.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/auth.server.ts")>();
  return {
    ...actual,
    getUserIdOrNull: vi.fn().mockResolvedValue(null),
    getStaleAuthSessionDestroyCookie: vi.fn().mockResolvedValue(null),
  };
});

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
    expect(body.pagination).toEqual({
      limit: 20,
      hasNext: false,
      nextCursor: null,
    });
  });

  test("returns 400 with results shape when limit is invalid", async () => {
    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=test&limit=invalid"),
    } as never);

    expect(response.status).toBe(400);
    expect(searchWithCache).not.toHaveBeenCalled();
    const body = (await response.json()) as {
      results: unknown[];
      pagination: unknown;
    };
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
    expect(searchWithCache).toHaveBeenCalledWith("-", 20, undefined, "all", true, undefined, "all");
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

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      results: unknown[];
      pagination: { limit: number };
    };
    expect(body.error).toBe("Invalid search query");
    expect(body.results).toEqual([]);
    expect(body.pagination.limit).toBe(20);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("returns 400 with results shape when search fails due to invalid cursor", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(searchWithCache).mockRejectedValue(new Error("Invalid cursor format"));

    const validCursor = Buffer.from(
      JSON.stringify({ t: null, a: null, ar: null, p: null }),
    ).toString("base64");
    const response = await loader({
      ...makeRequest(
        `http://localhost/api/search?q=test&cursor=${encodeURIComponent(validCursor)}`,
      ),
    } as never);

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      results: unknown[];
      pagination: { limit: number };
    };
    expect(body.error).toBe("Invalid search query");
    expect(body.results).toEqual([]);
    expect(body.pagination.limit).toBe(20);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("returns 500 for non-syntax internal search failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(searchWithCache).mockRejectedValue(new Error("database is locked"));

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
    expect(consoleError).toHaveBeenCalled();
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
    expect(searchWithCache).toHaveBeenCalledWith(
      "test",
      20,
      undefined,
      "all",
      true,
      undefined,
      "all",
    );
    const body = await response.json();
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("pagination");
  });

  test("stale session cookie returns JSON catalog response, not redirect", async () => {
    const { getUserIdOrNull, getStaleAuthSessionDestroyCookie, sessionKey } =
      await import("#app/utils/auth.server.ts");
    const { authSessionStorage } = await import("#app/utils/session.server.ts");
    const deletedSessionId = `stale-${Math.random().toString(36).slice(2, 12)}`;
    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, deletedSessionId);
    const cookie = await authSessionStorage.commitSession(authSession);

    const actual = await vi.importActual<typeof import("#app/utils/auth.server.ts")>(
      "#app/utils/auth.server.ts",
    );
    vi.mocked(getUserIdOrNull).mockImplementationOnce(actual.getUserIdOrNull);
    vi.mocked(getStaleAuthSessionDestroyCookie).mockImplementationOnce(
      actual.getStaleAuthSessionDestroyCookie,
    );

    vi.mocked(searchWithCache).mockResolvedValue({
      results: [],
      pagination: { limit: 20, hasNext: false, nextCursor: null },
    });

    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=beatles"),
      request: new Request("http://localhost/api/search?q=beatles", {
        headers: { cookie },
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("results");
  });

  test("returns 400 when guest requests scope=library", async () => {
    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=beatles&scope=library"),
    } as never);

    expect(response.status).toBe(400);
    expect(searchWithCache).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Library scope requires authentication");
  });

  test("passes scope=library and authenticated userId to searchWithCache", async () => {
    const { getUserIdOrNull } = await import("#app/utils/auth.server.ts");
    vi.mocked(getUserIdOrNull).mockResolvedValueOnce("user-kody");
    vi.mocked(searchWithCache).mockResolvedValue({
      results: [],
      pagination: { limit: 20, hasNext: false, nextCursor: null },
    });

    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=beatles&scope=library"),
    } as never);

    expect(response.status).toBe(200);
    expect(searchWithCache).toHaveBeenCalledWith(
      "beatles",
      20,
      undefined,
      "all",
      true,
      "user-kody",
      "library",
    );
  });

  test("passes scope=all with authenticated userId so Personal Play Boost still applies", async () => {
    const { getUserIdOrNull } = await import("#app/utils/auth.server.ts");
    vi.mocked(getUserIdOrNull).mockResolvedValueOnce("user-kody");
    vi.mocked(searchWithCache).mockResolvedValue({
      results: [],
      pagination: { limit: 20, hasNext: false, nextCursor: null },
    });

    const response = await loader({
      ...makeRequest("http://localhost/api/search?q=beatles&scope=all"),
    } as never);

    expect(response.status).toBe(200);
    expect(searchWithCache).toHaveBeenCalledWith(
      "beatles",
      20,
      undefined,
      "all",
      true,
      "user-kody",
      "all",
    );
  });
});
