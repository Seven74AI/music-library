import { afterEach, describe, expect, test } from "vitest";
import { getEnv } from "./env.server.ts";

describe("getEnv", () => {
  const originalDisableServiceWorker = process.env.DISABLE_SERVICE_WORKER;

  afterEach(() => {
    if (originalDisableServiceWorker === undefined) {
      delete process.env.DISABLE_SERVICE_WORKER;
    } else {
      process.env.DISABLE_SERVICE_WORKER = originalDisableServiceWorker;
    }
  });

  test("exposes DISABLE_SERVICE_WORKER when explicitly set", () => {
    process.env.DISABLE_SERVICE_WORKER = "true";
    expect(getEnv().DISABLE_SERVICE_WORKER).toBe("true");
  });

  test("does not infer DISABLE_SERVICE_WORKER from PLAYWRIGHT_TEST_BASE_URL", () => {
    delete process.env.DISABLE_SERVICE_WORKER;
    process.env.PLAYWRIGHT_TEST_BASE_URL = "http://localhost:3000/";
    expect(getEnv().DISABLE_SERVICE_WORKER).toBeUndefined();
    delete process.env.PLAYWRIGHT_TEST_BASE_URL;
  });
});
