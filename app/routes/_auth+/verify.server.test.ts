import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { isEncryptedVerificationSecret } from "#app/utils/token-cipher.server.ts";
import { generateTOTP } from "#app/utils/totp.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { isCodeValid, prepareVerification } from "./verify.server.ts";

const createdUserIds: string[] = [];

function request() {
  return new Request("http://localhost/login", {
    headers: { host: "localhost" },
  });
}

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

describe("verification secret encryption at rest", () => {
  test("stores the TOTP secret encrypted and reads it back through the same decrypt path", async () => {
    const user = await createAccount();

    const { otp } = await prepareVerification({
      period: 30,
      request: request(),
      type: "onboarding",
      target: user.id,
    });

    const stored = await prisma.verification.findUnique({
      where: { target_type: { target: user.id, type: "onboarding" } },
      select: { secret: true },
    });

    expect(stored).not.toBeNull();
    const secret = stored!.secret;
    // At rest the secret must be ciphertext, never the plaintext base32.
    expect(isEncryptedVerificationSecret(secret)).toBe(true);
    expect(secret.startsWith("enc1:")).toBe(true);

    // The OTP we just generated validates through the same decrypt path.
    expect(await isCodeValid({ code: otp, type: "onboarding", target: user.id })).toBe(true);
  });

  test("reads a legacy plaintext secret so pre-migration rows still verify", async () => {
    const user = await createAccount();

    // Simulate a pre-migration row: a plaintext base32 secret written directly.
    const { otp, secret } = await generateTOTP({
      algorithm: "SHA-256",
      charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
      period: 30,
    });

    await prisma.verification.create({
      data: {
        type: "onboarding",
        target: user.id,
        secret,
        algorithm: "SHA-256",
        digits: 6,
        period: 30,
        charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
        expiresAt: new Date(Date.now() + 30_000),
      },
    });

    // Legacy plaintext reads unchanged and still validates (no 2FA lockout).
    expect(await isCodeValid({ code: otp, type: "onboarding", target: user.id })).toBe(true);
  });
});
