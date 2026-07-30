// @vitest-environment jsdom

import { describe, expect, test, vi, afterEach } from "vitest";
import type { DataStrategyResult } from "react-router";
import type { MiddlewareFunction } from "react-router";
import {
  resolveOfflineData,
  shouldSkipOfflineMiddlewareRoute,
} from "#app/features/offline-app/offline-route-policies.client.ts";
import { shouldSubstituteOfflineResult } from "./offline-client.middleware.client.ts";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeNext(
  result?: Record<string, DataStrategyResult>,
): () => Promise<Record<string, DataStrategyResult>> {
  const defaultResult: DataStrategyResult = {
    type: "data",
    result: { user: null },
  };
  return vi.fn().mockResolvedValue(result ?? { root: defaultResult });
}

/** Dynamic import of the middleware — avoids stale module cache. */
async function loadMiddleware(): Promise<MiddlewareFunction<Record<string, DataStrategyResult>>> {
  vi.resetModules();
  const mod = await import("./offline-client.middleware.client.ts");
  return mod.offlineClientMiddleware;
}

/** Minimal DataFunctionArgs for middleware testing.
 *  Uses `as any` because RouterContextProvider has get/set that
 *  are irrelevant to offline middleware testing. */
function makeArgs(url = "https://example.com/") {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: "/",
    params: {},
    context: {} as any,
  };
}

// ── shouldSkipOfflineMiddlewareRoute ────────────────────────────────────

describe("shouldSkipOfflineMiddlewareRoute", () => {
  test("skips API, resource, and auth routes", () => {
    expect(shouldSkipOfflineMiddlewareRoute("routes/_auth+/login")).toBe(true);
    expect(shouldSkipOfflineMiddlewareRoute("routes/resources+/healthcheck")).toBe(true);
  });

  test("does not skip regular routes", () => {
    expect(shouldSkipOfflineMiddlewareRoute("routes/library.index")).toBe(false);
    expect(shouldSkipOfflineMiddlewareRoute("routes/search")).toBe(false);
    expect(shouldSkipOfflineMiddlewareRoute("root")).toBe(false);
  });
});

// ── resolveOfflineData ──────────────────────────────────────────────────

describe("resolveOfflineData", () => {
  test("returns shaped search fallback", async () => {
    const fallback = await resolveOfflineData(
      "routes/search",
      new Request("https://example.com/search?q=foo"),
    );
    expect(fallback).toMatchObject({ results: [], query: "" });
  });

  test("extracts track id from pathname", async () => {
    const fallback = (await resolveOfflineData(
      "routes/library.$trackId",
      new Request("https://example.com/library/track-123"),
    )) as { track: { id: string } };
    expect(fallback.track.id).toBe("track-123");
  });
});

// ── shouldSubstituteOfflineResult ───────────────────────────────────────

describe("shouldSubstituteOfflineResult", () => {
  test("substitutes loader errors", () => {
    expect(
      shouldSubstituteOfflineResult({
        type: "error",
        result: new Error("Unauthorized"),
      }),
    ).toBe(true);
  });

  test("substitutes missing results", () => {
    expect(shouldSubstituteOfflineResult(undefined)).toBe(true);
  });

  test("keeps successful data", () => {
    expect(
      shouldSubstituteOfflineResult({
        type: "data",
        result: { ok: true },
      }),
    ).toBe(false);
  });
});

// ── offlineClientMiddleware ─────────────────────────────────────────────
//
// NOTE: we do NOT stub `document` to test the server guard because
// jsdom's `document` uses property descriptors that vi.unstubAllGlobals
// cannot restore, leaking `undefined` into subsequent tests.  The server
// guard is a trivial `typeof document === "undefined"` check —
// `isOfflineEnvironment` is tested separately for server environment
// correctness (see is-offline-environment.test.ts).

describe("offlineClientMiddleware", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("online path: runs next() and passes results through", async () => {
    // jsdom defaults: document exists, navigator.onLine is true
    const mw = await loadMiddleware();

    const next = makeNext({
      root: {
        type: "data",
        result: {
          user: { id: "1", name: "Test", username: "test" },
          requestInfo: {
            hints: {},
            origin: "",
            path: "/",
            userPrefs: { theme: "light" as const },
          },
          ENV: {},
        },
      },
    });

    const result = (await mw(makeArgs(), next)) as Record<string, DataStrategyResult>;

    expect(next).toHaveBeenCalledTimes(1);
    // Online: results pass through unchanged
    expect(result).toEqual({
      root: {
        type: "data",
        result: expect.objectContaining({
          user: { id: "1", name: "Test", username: "test" },
        }),
      },
    });
  });

  test("offline path: patches error results with offline stubs", async () => {
    // Stub BEFORE loading middleware — isOfflineEnvironment reads
    // navigator.onLine at call time within the middleware function
    vi.stubGlobal("navigator", { onLine: false });

    const mw = await loadMiddleware();

    const next = makeNext({
      root: { type: "error", result: new Error("Network error") },
      "routes/search": {
        type: "error",
        result: new Error("Network error"),
      },
    });

    const result = (await mw(makeArgs("https://example.com/search?q=foo"), next)) as Record<
      string,
      DataStrategyResult
    >;

    expect(next).toHaveBeenCalledTimes(1);

    // Root patched with offline shell — may have a persisted user from
    // a previous online session, or null if nothing was cached
    expect(result.root).toEqual({
      type: "data",
      result: expect.objectContaining({
        offlineShell: true,
      }),
    });
    expect(result.root).toHaveProperty("result.user");

    // Search patched with offline search stub
    expect(result["routes/search"]).toEqual({
      type: "data",
      result: expect.objectContaining({ results: [], query: "" }),
    });
  });

  test("offline path: preserves successful data results (type=data → no substitute)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const mw = await loadMiddleware();

    const next = makeNext({
      root: { type: "data", result: { user: null } },
    });

    const result = (await mw(makeArgs(), next)) as Record<string, DataStrategyResult>;

    // type=data → shouldSubstituteOfflineResult returns false → preserved
    expect(result.root).toEqual({
      type: "data",
      result: expect.objectContaining({ user: null }),
    });
  });

  test("is a function (backward compat)", () => {
    // Verify the static import (used elsewhere) resolves correctly
    expect(typeof shouldSubstituteOfflineResult).toBe("function");
  });
});
