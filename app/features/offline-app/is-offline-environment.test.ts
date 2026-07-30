import { describe, expect, test, vi, afterEach } from "vitest";
import { isOfflineEnvironment } from "./is-offline-environment.ts";

describe("isOfflineEnvironment (shared)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns false during SSR when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isOfflineEnvironment()).toBe(false);
  });

  test("returns true when navigator reports offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOfflineEnvironment()).toBe(true);
  });

  test("returns false when navigator reports online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOfflineEnvironment()).toBe(false);
  });

  test("returns false when navigator exists but onLine is not a boolean (Node 22)", () => {
    vi.stubGlobal("navigator", { onLine: undefined });
    expect(isOfflineEnvironment()).toBe(false);
  });

  test("returns false when navigator exists but onLine is a non-boolean truthy value", () => {
    vi.stubGlobal("navigator", { onLine: "online" });
    expect(isOfflineEnvironment()).toBe(false);
  });
});
