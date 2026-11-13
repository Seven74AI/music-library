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
  // Minimal, explicit production env. Never spread process.env: the result must
  // not depend on the shell running the tests.
  const VALID_TOKEN_ENCRYPTION_KEY = "unit-test-production-token-encryption-key";
  const buildProductionEnv = (): NodeJS.ProcessEnv =>
    ({
      NODE_ENV: "production",
      DATABASE_PATH: "/tmp/unit-test.db",
      DATABASE_URL: "file:/tmp/unit-test.db",
      CACHE_DATABASE_PATH: "/tmp/unit-test-cache.db",
      SESSION_SECRET: "unit-test-session-secret",
      IP_HASH_SALT: "unit-test-ip-hash-salt",
      TOKEN_ENCRYPTION_KEY: VALID_TOKEN_ENCRYPTION_KEY,
      INTERNAL_COMMAND_TOKEN: "unit-test-internal-command-token",
      HONEYPOT_SECRET: "unit-test-honeypot-secret",
      AWS_ACCESS_KEY_ID: "unit-test-access-key",
      AWS_SECRET_ACCESS_KEY: "unit-test-secret-key",
      AWS_REGION: "auto",
      AWS_ENDPOINT_URL_S3: "https://storage.example.test",
      BUCKET_NAME: "unit-test-bucket",
    }) as NodeJS.ProcessEnv;

  test("production rejects PLAYWRIGHT_TEST_BASE_URL unless MOCKS=true", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const env = {
      ...buildProductionEnv(),
      PLAYWRIGHT_TEST_BASE_URL: "http://localhost:3000/",
      MOCKS: "false",
    };

    try {
      expect(validateEnv(env).success).toBe(false);
      expect(
        validateEnv({ ...env, MOCKS: "true", PLAYWRIGHT_TEST_BASE_URL: "http://localhost:3000/" })
          .success,
      ).toBe(true);
      const { PLAYWRIGHT_TEST_BASE_URL: _playwright, ...withoutPlaywright } = env;
      expect(validateEnv(withoutPlaywright).success).toBe(true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test("production requires TOKEN_ENCRYPTION_KEY and rejects the dev placeholder and short keys", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const env = buildProductionEnv();
    delete env.TOKEN_ENCRYPTION_KEY;

    try {
      expect(validateEnv(env).success).toBe(false);
      expect(validateEnv({ ...env, TOKEN_ENCRYPTION_KEY: DEV_TOKEN_ENCRYPTION_KEY }).success).toBe(
        false,
      );
      expect(validateEnv({ ...env, TOKEN_ENCRYPTION_KEY: "short" }).success).toBe(false);
      expect(
        validateEnv({
          ...env,
          TOKEN_ENCRYPTION_KEY: VALID_TOKEN_ENCRYPTION_KEY,
        }).success,
      ).toBe(true);
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
