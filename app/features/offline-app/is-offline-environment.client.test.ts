/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { isOfflineEnvironment } from "./is-offline-environment.client.ts";

describe("isOfflineEnvironment", () => {
  test("returns true when navigator reports offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOfflineEnvironment()).toBe(true);
  });

  test("returns false when navigator reports online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOfflineEnvironment()).toBe(false);
  });
});
