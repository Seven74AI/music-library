import { describe, expect, test } from "vitest";
import {
  OFFLINE_ROUTE_POLICIES,
  resolveOfflineData,
  shouldSkipOfflineMiddlewareRoute,
} from "./offline-route-policies.client.ts";

describe("OFFLINE_ROUTE_POLICIES", () => {
  test("registers unified stubs for previously-live routes", () => {
    // "live" routes now have sync or async stub entries
    expect(OFFLINE_ROUTE_POLICIES["routes/library.index"]).toBeDefined();
    expect(OFFLINE_ROUTE_POLICIES["routes/downloads"]).toBeDefined();
    expect(OFFLINE_ROUTE_POLICIES.root).toBeDefined();
  });

  test("registers stub routes for network-only views", () => {
    expect(OFFLINE_ROUTE_POLICIES["routes/search"]).toBeDefined();
    expect(OFFLINE_ROUTE_POLICIES["routes/admin+/audio-queue"]).toBeDefined();
  });
});

describe("shouldSkipOfflineMiddlewareRoute", () => {
  test("skips API, resource, and auth routes", () => {
    expect(shouldSkipOfflineMiddlewareRoute("routes/_auth+/login")).toBe(true);
    expect(shouldSkipOfflineMiddlewareRoute("routes/resources+/healthcheck")).toBe(true);
    expect(shouldSkipOfflineMiddlewareRoute("routes/api+/search")).toBe(true);
  });

  test("does NOT skip regular routes (unified — all go through middleware)", () => {
    expect(shouldSkipOfflineMiddlewareRoute("routes/library.index")).toBe(false);
    expect(shouldSkipOfflineMiddlewareRoute("routes/search")).toBe(false);
    expect(shouldSkipOfflineMiddlewareRoute("routes/music")).toBe(false);
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

  test("extracts track id from pathname for library track detail", async () => {
    const fallback = (await resolveOfflineData(
      "routes/library.$trackId",
      new Request("https://example.com/library/track-123"),
    )) as { track: { id: string } };
    expect(fallback.track.id).toBe("track-123");
  });

  test("returns empty object for unregistered routes", async () => {
    expect(
      await resolveOfflineData("routes/unknown", new Request("https://example.com/unknown")),
    ).toEqual({});
  });

  test("returns root fallback shell", async () => {
    const fallback = (await resolveOfflineData("root", new Request("https://example.com/"))) as {
      offlineShell: boolean;
    };
    expect(fallback.offlineShell).toBe(true);
  });
});
