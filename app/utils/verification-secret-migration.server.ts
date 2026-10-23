/**
 * Verification secret encryption migration.
 *
 * Re-encrypts `Verification.secret` rows that are still stored in plaintext.
 * Designed to be idempotent: rows already carrying the `enc1:` prefix are
 * skipped, so the migration can be re-run safely after a partial failure
 * without double-encrypting (which would lock users out of 2FA).
 */

import { prisma } from "./db.server.ts";
import {
  encryptVerificationSecret,
  isEncryptedVerificationSecret,
} from "./token-cipher.server.ts";

export interface VerificationSecretMigrationResult {
  total: number;
  encrypted: number;
  alreadyEncrypted: number;
}

/**
 * Encrypt every plaintext `Verification.secret` row in place.
 *
 * The secret value is a TOTP base32 string. Plaintext base32 values never
 * start with `enc1:` (the alphabet is A-Z / 2-7, no lowercase or colon), so
 * the prefix check reliably distinguishes legacy plaintext from ciphertext.
 *
 * `encryptVerificationSecret` reads the production-required
 * `TOKEN_ENCRYPTION_KEY` and fails closed if it is missing/short/dev in
 * production, so the migration never writes a keyed-to-nothing ciphertext.
 */
export async function migrateVerificationSecrets(
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<VerificationSecretMigrationResult> {
  const { batchSize = 100, onProgress } = options;

  const total = await prisma.verification.count();
  let processed = 0;
  let encrypted = 0;
  let alreadyEncrypted = 0;

  while (processed < total) {
    const rows = await prisma.verification.findMany({
      select: { id: true, secret: true },
      orderBy: { id: "asc" },
      take: batchSize,
      skip: processed,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (isEncryptedVerificationSecret(row.secret)) {
        alreadyEncrypted++;
        continue;
      }

      await prisma.verification.update({
        where: { id: row.id },
        data: { secret: encryptVerificationSecret(row.secret) },
      });
      encrypted++;
    }

    processed += rows.length;
    onProgress?.(processed, total);
  }

  return { total, encrypted, alreadyEncrypted };
}
