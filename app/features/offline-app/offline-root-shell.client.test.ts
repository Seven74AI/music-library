/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  createFallbackOfflineRootShell,
  persistOfflineRootShell,
  readOfflineRootShell,
  resolveOfflineEffectiveTheme,
} from "./offline-root-shell.client.ts";

describe("offline root shell", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("persists and reads cached root shell data", () => {
    persistOfflineRootShell({
      user: {
        id: "user-1",
        name: "Kody",
        username: "kody",
        image: null,
        roles: [],
      },
      requestInfo: {
        hints: {},
        origin: "https://music.test",
        path: "/downloads",
        userPrefs: { theme: "dark" },
      },
      ENV: { NODE_ENV: "production" },
    });

    const shell = readOfflineRootShell();
    expect(shell?.user?.username).toBe("kody");
    expect(shell?.requestInfo.userPrefs.theme).toBe("dark");
  });

  test("falls back to cached user when offline", () => {
    persistOfflineRootShell({
      user: {
        id: "user-1",
        name: "Kody",
        username: "kody",
        image: null,
        roles: [],
      },
      requestInfo: {
        hints: {},
        origin: "https://music.test",
        path: "/",
        userPrefs: { theme: "light" },
      },
      ENV: {},
    });

    const shell = createFallbackOfflineRootShell();
    expect(shell.offlineShell).toBe(true);
    expect(shell.user?.id).toBe("user-1");
  });

  test("system theme with dark client hint resolves to dark offline shell", () => {
    persistOfflineRootShell({
      user: null,
      requestInfo: {
        hints: { theme: "dark", timeZone: "UTC" },
        origin: "https://music.test",
        path: "/",
        userPrefs: { theme: null },
      },
      ENV: {},
    });

    const shell = createFallbackOfflineRootShell();
    expect(shell.requestInfo.userPrefs.theme).toBeNull();
    expect(shell.requestInfo.hints.theme).toBe("dark");
    expect(resolveOfflineEffectiveTheme(shell.requestInfo)).toBe("dark");
  });

  test("preserves persisted theme preference in the fallback shell", () => {
    persistOfflineRootShell({
      user: null,
      requestInfo: {
        hints: {},
        origin: "https://music.test",
        path: "/",
        userPrefs: { theme: "dark" },
      },
      ENV: {},
    });

    const shell = createFallbackOfflineRootShell();
    expect(shell.requestInfo.userPrefs.theme).toBe("dark");
  });
});
