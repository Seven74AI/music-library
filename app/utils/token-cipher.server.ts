import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Used when `TOKEN_ENCRYPTION_KEY` is unset outside production.
 * Documented in `.env.example`. This is not an OAuth token and must not be
 * used in production.
 */
export const DEV_TOKEN_ENCRYPTION_KEY = "dev-token-encryption-key-change-me";

/** Version prefix so legacy plaintext JSON in `Connection.tokens` still reads. */
export const TOKEN_CIPHER_PREFIX = "enc1:";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MIN_PRODUCTION_KEY_LENGTH = 32;

/**
 * Secret for AES-256-GCM encryption of `Connection.tokens`.
 * Returns null in production when the key is unset so startup can continue.
 * A key that is set in production must be at least 32 characters and must not
 * be the dev fallback. Dev and test use {@link DEV_TOKEN_ENCRYPTION_KEY} when unset.
 */
export function getTokenEncryptionKey(): string | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production") {
    if (!secret) return null;
    if (secret.length < MIN_PRODUCTION_KEY_LENGTH || secret === DEV_TOKEN_ENCRYPTION_KEY) {
      throw new Error(
        "TOKEN_ENCRYPTION_KEY environment variable is required in production. " +
          "Generate one with: openssl rand -hex 32",
      );
    }
    return secret;
  }
  if (secret) return secret;
  return DEV_TOKEN_ENCRYPTION_KEY;
}

export function isEncryptedConnectionTokens(stored: string): boolean {
  return stored.startsWith(TOKEN_CIPHER_PREFIX);
}

/**
 * Seal a token JSON string. The AES-256 key is SHA-256(secret), so the env
 * value must be high entropy in production (`openssl rand -hex 32`).
 * Output is `enc1:` plus base64url(iv || authTag || ciphertext).
 */
export function encryptConnectionTokens(
  plaintext: string,
  secret: string | null = getTokenEncryptionKey(),
): string {
  if (!secret) return plaintext;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveAesKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return TOKEN_CIPHER_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

/**
 * Open a `Connection.tokens` value. Ciphertext is authenticated with
 * AES-256-GCM. A value without the `enc1:` prefix is legacy plaintext JSON
 * and is returned unchanged so the next write can store ciphertext.
 */
export function decryptConnectionTokens(stored: string, secret?: string | null): string {
  if (!isEncryptedConnectionTokens(stored)) {
    return stored;
  }

  const key = secret === undefined ? getTokenEncryptionKey() : secret;
  if (!key) {
    throw new Error("Failed to decrypt service connection tokens");
  }

  const packed = Buffer.from(stored.slice(TOKEN_CIPHER_PREFIX.length), "base64url");
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Failed to decrypt service connection tokens");
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveAesKey(key), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt service connection tokens");
  }
}

function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
