import { afterEach, describe, expect, test } from "vitest";
import { DEV_TOKEN_ENCRYPTION_KEY } from "./token-cipher.server.ts";
import { formatInvalidEnvMessage, getEnv, validateEnv } from "./env.server.ts";

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

describe("validateEnv", () => {
  test("production starts when TOKEN_ENCRYPTION_KEY is unset and rejects the dev placeholder", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const env = { ...process.env };
    delete env.TOKEN_ENCRYPTION_KEY;

    try {
      expect(validateEnv(env).success).toBe(true);
      expect(validateEnv({ ...env, TOKEN_ENCRYPTION_KEY: DEV_TOKEN_ENCRYPTION_KEY }).success).toBe(
        false,
      );
      expect(validateEnv({ ...env, TOKEN_ENCRYPTION_KEY: "short" }).success).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

describe("formatInvalidEnvMessage", () => {
  test("names the invalid variables", () => {
    expect(
      formatInvalidEnvMessage({
        IP_HASH_SALT: ["Too small: expected string to have >=8 characters"],
        SESSION_SECRET: ["Required"],
      }),
    ).toBe("Invalid environment variables: IP_HASH_SALT, SESSION_SECRET");
  });
});
