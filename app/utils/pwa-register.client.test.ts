/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerServiceWorker, shouldDisableServiceWorker } from "./pwa-register.client.ts";

describe("shouldDisableServiceWorker", () => {
  test("disables when DISABLE_SERVICE_WORKER is true", () => {
    expect(shouldDisableServiceWorker({ MODE: "production", DISABLE_SERVICE_WORKER: "true" })).toBe(
      true,
    );
  });

  test("allows opt-in during development when DISABLE_SERVICE_WORKER is false", () => {
    expect(
      shouldDisableServiceWorker({ MODE: "development", DISABLE_SERVICE_WORKER: "false" }),
    ).toBe(false);
  });

  test("disables by default outside production so navigateFallback cannot shadow SSR", () => {
    expect(shouldDisableServiceWorker({ MODE: "development" })).toBe(true);
    expect(shouldDisableServiceWorker({ MODE: "test" })).toBe(true);
  });

  test("registers in production when not explicitly disabled", () => {
    expect(shouldDisableServiceWorker({ MODE: "production" })).toBe(false);
  });
});

describe("registerServiceWorker", () => {
  const originalEnv = window.ENV;

  beforeEach(() => {
    window.ENV = { MODE: "development" } as typeof window.ENV;
  });

  afterEach(() => {
    window.ENV = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("unregisters existing workers and reloads when stuck on the offline shell", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations,
        register: vi.fn(),
        addEventListener: vi.fn(),
      },
    });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    document.documentElement.dataset.offlineShell = "true";

    registerServiceWorker();
    await vi.waitFor(() => {
      expect(unregister).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();

    delete document.documentElement.dataset.offlineShell;
  });

  test("registers in production when service worker is enabled", async () => {
    window.ENV = { MODE: "production" } as typeof window.ENV;
    const register = vi.fn().mockResolvedValue({
      waiting: null,
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi.fn(),
        register,
        addEventListener: vi.fn(),
      },
    });

    registerServiceWorker();
    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    });
  });
});
