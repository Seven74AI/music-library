import { afterEach, describe, expect, test } from "vitest";
import {
  DEV_TOKEN_ENCRYPTION_KEY,
  decryptConnectionTokens,
  encryptConnectionTokens,
  getTokenEncryptionKey,
  isEncryptedConnectionTokens,
} from "./token-cipher.server.ts";

const FAKE_ACCESS_TOKEN = "fake-access-token";
const FAKE_REFRESH_TOKEN = "fake-refresh-token";

function tamperCiphertext(stored: string): string {
  const index = stored.indexOf(":") + 8;
  const replacement = stored[index] === "A" ? "B" : "A";
  return stored.slice(0, index) + replacement + stored.slice(index + 1);
}

const fakeTokenJson = JSON.stringify({
  access_token: FAKE_ACCESS_TOKEN,
  refresh_token: FAKE_REFRESH_TOKEN,
  expiry_date: 1_700_000_000_000,
  token_type: "Bearer",
});

describe("connection token cipher", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;

  afterEach(() => {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    }
  });

  test("encrypts and decrypts a token payload with AES-256-GCM", () => {
    const stored = encryptConnectionTokens(fakeTokenJson, "unit-test-token-encryption-key");

    expect(isEncryptedConnectionTokens(stored)).toBe(true);
    expect(stored.startsWith("enc1:")).toBe(true);
    expect(stored).not.toContain(FAKE_ACCESS_TOKEN);
    expect(stored).not.toContain(FAKE_REFRESH_TOKEN);
    expect(decryptConnectionTokens(stored, "unit-test-token-encryption-key")).toBe(fakeTokenJson);
  });

  test("uses a fresh nonce so the same payload does not encrypt twice the same way", () => {
    const key = "unit-test-token-encryption-key";
    const first = encryptConnectionTokens(fakeTokenJson, key);
    const second = encryptConnectionTokens(fakeTokenJson, key);

    expect(first).not.toBe(second);
    expect(decryptConnectionTokens(first, key)).toBe(fakeTokenJson);
    expect(decryptConnectionTokens(second, key)).toBe(fakeTokenJson);
  });

  test("rejects a ciphertext that was tampered with or sealed with another key", () => {
    const stored = encryptConnectionTokens(fakeTokenJson, "unit-test-token-encryption-key");
    const tampered = tamperCiphertext(stored);

    expect(() => decryptConnectionTokens(tampered, "unit-test-token-encryption-key")).toThrow(
      /Failed to decrypt service connection tokens/,
    );
    expect(() => decryptConnectionTokens(stored, "different-unit-test-key")).toThrow(
      /Failed to decrypt service connection tokens/,
    );

    try {
      decryptConnectionTokens(tampered, "unit-test-token-encryption-key");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(FAKE_ACCESS_TOKEN);
      expect((error as Error).message).not.toContain(FAKE_REFRESH_TOKEN);
    }
  });

  test("reads legacy plaintext JSON without treating it as ciphertext", () => {
    const legacy = JSON.stringify({
      access_token: "legacy-plaintext-access-token",
      refresh_token: "legacy-plaintext-refresh-token",
    });

    expect(legacy.startsWith("{")).toBe(true);
    expect(isEncryptedConnectionTokens(legacy)).toBe(false);
    expect(decryptConnectionTokens(legacy, "unit-test-token-encryption-key")).toBe(legacy);
  });

  test("uses TOKEN_ENCRYPTION_KEY when it is set", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "env-token-encryption-key-for-unit-test";

    expect(getTokenEncryptionKey()).toBe("env-token-encryption-key-for-unit-test");
    const stored = encryptConnectionTokens(fakeTokenJson);
    expect(stored).not.toContain(FAKE_ACCESS_TOKEN);
    expect(decryptConnectionTokens(stored)).toBe(fakeTokenJson);
    expect(() => decryptConnectionTokens(stored, DEV_TOKEN_ENCRYPTION_KEY)).toThrow(
      /Failed to decrypt service connection tokens/,
    );
  });

  test("falls back to a non-secret dev key that is not a token", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.NODE_ENV = "test";

    expect(getTokenEncryptionKey()).toBe(DEV_TOKEN_ENCRYPTION_KEY);
    expect(DEV_TOKEN_ENCRYPTION_KEY).not.toContain(FAKE_ACCESS_TOKEN);
    expect(DEV_TOKEN_ENCRYPTION_KEY).not.toContain(FAKE_REFRESH_TOKEN);
    expect(DEV_TOKEN_ENCRYPTION_KEY).not.toMatch(/^ya29\./);
    expect(DEV_TOKEN_ENCRYPTION_KEY).not.toMatch(/^1\/\//);

    const stored = encryptConnectionTokens(fakeTokenJson);
    expect(decryptConnectionTokens(stored)).toBe(fakeTokenJson);
    expect(stored).not.toContain(FAKE_ACCESS_TOKEN);
  });

  test("requires a production key that is not the dev fallback", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => getTokenEncryptionKey()).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => encryptConnectionTokens(fakeTokenJson)).toThrow(/TOKEN_ENCRYPTION_KEY/);

    process.env.TOKEN_ENCRYPTION_KEY = "short";
    expect(() => getTokenEncryptionKey()).toThrow(/TOKEN_ENCRYPTION_KEY/);

    process.env.TOKEN_ENCRYPTION_KEY = DEV_TOKEN_ENCRYPTION_KEY;
    expect(() => getTokenEncryptionKey()).toThrow(/TOKEN_ENCRYPTION_KEY/);

    const productionKey = "unit-test-production-token-encryption-key";
    process.env.TOKEN_ENCRYPTION_KEY = productionKey;
    expect(getTokenEncryptionKey()).toBe(productionKey);
    expect(decryptConnectionTokens(encryptConnectionTokens(fakeTokenJson))).toBe(fakeTokenJson);
  });
});
