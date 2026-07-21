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
});
