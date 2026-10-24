import { afterEach, describe, expect, test } from "vitest";
import {
  decryptVerificationSecret,
  encryptVerificationSecret,
  isEncryptedVerificationSecret,
} from "./token-cipher.server.ts";
import { generateTOTP } from "./totp.server.ts";

const TEST_KEY = "unit-test-verification-secret-encryption-key";

function tamperCiphertext(stored: string): string {
  const index = stored.indexOf(":") + 8;
  const replacement = stored[index] === "A" ? "B" : "A";
  return stored.slice(0, index) + replacement + stored.slice(index + 1);
}

describe("verification secret cipher", () => {
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

  test("round-trips a freshly generated TOTP secret", async () => {
    const { secret } = await generateTOTP();

    const stored = encryptVerificationSecret(secret, TEST_KEY);

    expect(isEncryptedVerificationSecret(stored)).toBe(true);
    expect(stored.startsWith("enc1:")).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptVerificationSecret(stored, TEST_KEY)).toBe(secret);
  });

  test("uses a fresh nonce so the same secret does not encrypt twice the same way", async () => {
    const { secret } = await generateTOTP();
    const first = encryptVerificationSecret(secret, TEST_KEY);
    const second = encryptVerificationSecret(secret, TEST_KEY);

    expect(first).not.toBe(second);
    expect(decryptVerificationSecret(first, TEST_KEY)).toBe(secret);
    expect(decryptVerificationSecret(second, TEST_KEY)).toBe(secret);
  });

  test("already-encrypted values are recognized so a migration re-run skips them", async () => {
    const { secret } = await generateTOTP();
    const stored = encryptVerificationSecret(secret, TEST_KEY);

    // The migration's skip-guard depends on this classification: an encrypted
    // value must never be treated as plaintext and double-encrypted.
    expect(isEncryptedVerificationSecret(stored)).toBe(true);
    expect(isEncryptedVerificationSecret("JBSWY3DPEHPK3PXP")).toBe(false);
  });

  test("reads legacy plaintext base32 secrets unchanged", () => {
    const legacy = "JBSWY3DPEHPK3PXP";

    expect(isEncryptedVerificationSecret(legacy)).toBe(false);
    expect(decryptVerificationSecret(legacy, TEST_KEY)).toBe(legacy);
  });

  test("rejects tampered ciphertext or a different key without leaking the secret", async () => {
    const { secret } = await generateTOTP();
    const stored = encryptVerificationSecret(secret, TEST_KEY);
    const tampered = tamperCiphertext(stored);

    expect(() => decryptVerificationSecret(tampered, TEST_KEY)).toThrow(
      /Failed to decrypt verification secret/,
    );
    expect(() => decryptVerificationSecret(stored, "different-unit-test-key")).toThrow(
      /Failed to decrypt verification secret/,
    );

    try {
      decryptVerificationSecret(tampered, TEST_KEY);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  test("production without a key fails closed instead of storing plaintext", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => encryptVerificationSecret("JBSWY3DPEHPK3PXP")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
