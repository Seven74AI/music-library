/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { shouldShowOfflineErrorFallback } from "./offline-aware-error-boundary.tsx";

describe("shouldShowOfflineErrorFallback", () => {
  test("returns true for unexpected errors while offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(shouldShowOfflineErrorFallback(new Error("Cannot read user"))).toBe(true);
    vi.unstubAllGlobals();
  });

  test("returns false for route errors while offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(
      shouldShowOfflineErrorFallback({
        status: 404,
        statusText: "Not Found",
        data: "Not found",
        internal: false,
      }),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  test("returns false when online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(shouldShowOfflineErrorFallback(new Error("Cannot read user"))).toBe(false);
    vi.unstubAllGlobals();
  });

  test("returns false during SSR when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined);
    expect(shouldShowOfflineErrorFallback(new Error("Cannot read user"))).toBe(false);
    vi.unstubAllGlobals();
  });
});
