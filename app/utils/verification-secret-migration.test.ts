import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { decryptVerificationSecret } from "#app/utils/token-cipher.server.ts";
import { generateTOTP } from "#app/utils/totp.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { migrateVerificationSecrets } from "./verification-secret-migration.server.ts";

const createdUserIds: string[] = [];

async function createAccount() {
  const user = await prisma.user.create({ data: createUser() });
  createdUserIds.push(user.id);
  return user;
}

afterEach(async () => {
  await prisma.verification.deleteMany({ where: { target: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("verification secret migration", () => {
  test("encrypts plaintext rows and is idempotent across re-runs", async () => {
    const user = await createAccount();
    const { secret: plaintext } = await generateTOTP();

    // Simulate a pre-migration row: plaintext base32 secret written directly.
    await prisma.verification.create({
      data: {
        type: "onboarding",
        target: user.id,
        secret: plaintext,
        algorithm: "SHA-256",
        digits: 6,
        period: 30,
        charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
      },
    });

    const first = await migrateVerificationSecrets();
    expect(first.encrypted).toBeGreaterThanOrEqual(1);

    const afterFirst = await prisma.verification.findUniqueOrThrow({
      where: { target_type: { target: user.id, type: "onboarding" } },
      select: { secret: true },
    });
    expect(afterFirst.secret.startsWith("enc1:")).toBe(true);
    expect(decryptVerificationSecret(afterFirst.secret)).toBe(plaintext);

    // Re-run: nothing left to encrypt, and the row's ciphertext is untouched.
    const second = await migrateVerificationSecrets();
    expect(second.encrypted).toBe(0);

    const afterSecond = await prisma.verification.findUniqueOrThrow({
      where: { target_type: { target: user.id, type: "onboarding" } },
      select: { secret: true },
    });
    // No double encryption — the same ciphertext still decrypts to the original.
    expect(afterSecond.secret).toBe(afterFirst.secret);
    expect(decryptVerificationSecret(afterSecond.secret)).toBe(plaintext);
  });
});
