import { describe, expect, test, vi, afterEach } from "vitest";
import {
  isOfflineEnvironment,
  loadWithOfflineFallback,
  createOfflineClientLoader,
} from "./offline-loader.client.ts";

describe("isOfflineEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns true when navigator reports offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOfflineEnvironment()).toBe(true);
  });
});

describe("loadWithOfflineFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("falls back to offline loader when navigator is offline and server fails", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const serverLoader = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const offlineLoader = vi.fn().mockResolvedValue({ offline: true });

    const result = await loadWithOfflineFallback(serverLoader, offlineLoader);

    expect(serverLoader).toHaveBeenCalled();
    expect(offlineLoader).toHaveBeenCalled();
    expect(result).toEqual({ offline: true });
  });

  test("uses server loader when navigator is offline but fetch succeeds", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const serverLoader = vi.fn().mockResolvedValue({ online: true });
    const offlineLoader = vi.fn();

    const result = await loadWithOfflineFallback(serverLoader, offlineLoader);

    expect(serverLoader).toHaveBeenCalled();
    expect(offlineLoader).not.toHaveBeenCalled();
    expect(result).toEqual({ online: true });
  });

  test("falls back to offline loader when server loader fails while online", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const serverLoader = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const offlineLoader = vi.fn().mockResolvedValue({ offline: true });

    const result = await loadWithOfflineFallback(serverLoader, offlineLoader);

    expect(serverLoader).toHaveBeenCalled();
    expect(offlineLoader).toHaveBeenCalled();
    expect(result).toEqual({ offline: true });
  });

  test("rethrows non-network server errors while online", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const serverLoader = vi.fn().mockRejectedValue(new Error("Unauthorized"));
    const offlineLoader = vi.fn();

    await expect(loadWithOfflineFallback(serverLoader, offlineLoader)).rejects.toThrow(
      "Unauthorized",
    );
    expect(offlineLoader).not.toHaveBeenCalled();
  });

  test("falls back to offline loader when navigator reports offline and server fails with auth error", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const serverLoader = vi.fn().mockRejectedValue(new Error("Unauthorized"));
    const offlineLoader = vi.fn().mockResolvedValue({ offline: true });

    const result = await loadWithOfflineFallback(serverLoader, offlineLoader);

    expect(serverLoader).toHaveBeenCalled();
    expect(offlineLoader).toHaveBeenCalled();
    expect(result).toEqual({ offline: true });
  });

  test("does not treat unrelated TypeErrors as network failures", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const serverLoader = vi
      .fn()
      .mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'x')"));
    const offlineLoader = vi.fn();

    await expect(loadWithOfflineFallback(serverLoader, offlineLoader)).rejects.toThrow(
      "Cannot read properties of undefined (reading 'x')",
    );
    expect(offlineLoader).not.toHaveBeenCalled();
  });
});

describe("createOfflineClientLoader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses policy offline loader on network failure", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const clientLoader = createOfflineClientLoader("routes/_marketing+/index");
    const serverLoader = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await clientLoader({
      serverLoader,
      params: {},
      request: new Request("https://example.com/"),
    });

    expect(result).toEqual({ mode: "offline" });
  });
});
