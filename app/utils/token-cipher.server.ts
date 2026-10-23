import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Used when `TOKEN_ENCRYPTION_KEY` is unset outside production.
 * Documented in `.env.example`. This is not an OAuth token and must not be
 * used in production.
 */
export const DEV_TOKEN_ENCRYPTION_KEY = "dev-token-encryption-key-change-me";

/**
 * Version prefix so legacy plaintext still reads. Applied to both
 * `Connection.tokens` and `Verification.secret` ciphertext; a value without
 * the prefix is legacy plaintext and is returned unchanged on decrypt so the
 * read path never breaks before the migration re-encrypts rows.
 */
export const TOKEN_CIPHER_PREFIX = "enc1:";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MIN_PRODUCTION_KEY_LENGTH = 32;

/**
 * Secret for AES-256-GCM encryption of at-rest auth material
 * (`Connection.tokens` and `Verification.secret`).
 * In production the key is required: a missing, too-short, or dev-fallback key
 * throws so secrets are never stored at rest in plaintext. Dev and test
 * use {@link DEV_TOKEN_ENCRYPTION_KEY} when unset.
 */
export function getTokenEncryptionKey(): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production") {
    if (
      !secret ||
      secret.length < MIN_PRODUCTION_KEY_LENGTH ||
      secret === DEV_TOKEN_ENCRYPTION_KEY
    ) {
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

/** Whether a `Verification.secret` value is already encrypted at rest. */
export function isEncryptedVerificationSecret(stored: string): boolean {
  return isEncryptedConnectionTokens(stored);
}

/**
 * Seal a plaintext string. The AES-256 key is SHA-256(secret), so the env
 * value must be high entropy in production (`openssl rand -hex 32`).
 * Output is `enc1:` plus base64url(iv || authTag || ciphertext).
 */
function encryptEnvelope(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveAesKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return TOKEN_CIPHER_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

/**
 * Open an `enc1:`-prefixed value. Ciphertext is authenticated with AES-256-GCM.
 * `label` names the payload in the thrown error message so connection tokens
 * and verification secrets fail with a message that points at the right field.
 */
function decryptEnvelope(stored: string, key: string, label: string): string {
  const packed = Buffer.from(stored.slice(TOKEN_CIPHER_PREFIX.length), "base64url");
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(`Failed to decrypt ${label}`);
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveAesKey(key), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(`Failed to decrypt ${label}`);
  }
}

/**
 * Seal a `Connection.tokens` value. A value without the `enc1:` prefix is
 * legacy plaintext JSON and is returned unchanged on decrypt so the next write
 * can store ciphertext.
 */
export function encryptConnectionTokens(
  plaintext: string,
  secret: string = getTokenEncryptionKey(),
): string {
  return encryptEnvelope(plaintext, secret);
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

  return decryptEnvelope(stored, key, "service connection tokens");
}

/**
 * Seal a `Verification.secret` value (TOTP base32 secret). Uses the same
 * AES-256-GCM envelope and key as `Connection.tokens`.
 */
export function encryptVerificationSecret(
  plaintext: string,
  secret: string = getTokenEncryptionKey(),
): string {
  return encryptEnvelope(plaintext, secret);
}

/**
 * Open a `Verification.secret` value. A value without the `enc1:` prefix is
 * legacy plaintext (a base32 secret) and is returned unchanged so reads keep
 * working until the migration re-encrypts existing rows.
 */
export function decryptVerificationSecret(stored: string, secret?: string | null): string {
  if (!isEncryptedVerificationSecret(stored)) {
    return stored;
  }

  const key = secret === undefined ? getTokenEncryptionKey() : secret;
  if (!key) {
    throw new Error("Failed to decrypt verification secret");
  }

  return decryptEnvelope(stored, key, "verification secret");
}

function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
