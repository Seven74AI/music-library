#!/usr/bin/env tsx
/**
 * Verification secret encryption migration entrypoint.
 *
 * Re-encrypts plaintext `Verification.secret` rows in place. Idempotent —
 * rows already carrying the `enc1:` prefix are skipped, so it can be re-run
 * safely. Requires `TOKEN_ENCRYPTION_KEY` (production-enforced).
 *
 * Usage: npm run migrate:encrypt-verification-secrets
 */

import "dotenv/config";
import { migrateVerificationSecrets } from "../app/utils/verification-secret-migration.server.ts";

async function main() {
  console.log("Starting verification secret encryption migration...\n");

  try {
    const result = await migrateVerificationSecrets({
      batchSize: 100,
      onProgress: (current, total) => {
        const percent = Math.round((current / total) * 100);
        console.log(`Progress: ${current}/${total} verifications (${percent}%)`);
      },
    });

    console.log("\n✅ Migration complete!");
    console.log(`   Total: ${result.total}`);
    console.log(`   Encrypted: ${result.encrypted}`);
    console.log(`   Already encrypted: ${result.alreadyEncrypted}`);
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

main();
