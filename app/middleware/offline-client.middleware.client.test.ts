import { describe, expect, test } from "vitest";
import {
  resolveOfflineData,
  shouldSkipOfflineMiddlewareRoute,
} from "#app/features/offline-app/offline-route-policies.client.ts";
import {
  shouldSubstituteOfflineResult,
  offlineClientMiddleware,
} from "./offline-client.middleware.client.ts";

describe("shouldSkipOfflineMiddlewareRoute", () => {
  test("skips API, resource, and auth routes", () => {
    expect(shouldSkipOfflineMiddlewareRoute("routes/_auth+/login")).toBe(true);
    expect(shouldSkipOfflineMiddlewareRoute("routes/resources+/healthcheck")).toBe(true);
  });

  test("does not skip regular routes (unified middleware)", () => {
    expect(shouldSkipOfflineMiddlewareRoute("routes/library.index")).toBe(false);
    expect(shouldSkipOfflineMiddlewareRoute("routes/search")).toBe(false);
  });
});

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

describe("shouldSubstituteOfflineResult", () => {
  test("substitutes loader errors while offline", () => {
    expect(
      shouldSubstituteOfflineResult({
        type: "error",
        result: new Error("Unauthorized"),
      }),
    ).toBe(true);
  });

  test("substitutes missing loader results", () => {
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

describe("offlineClientMiddleware", () => {
  test("is a function", () => {
    expect(typeof offlineClientMiddleware).toBe("function");
  });
});
