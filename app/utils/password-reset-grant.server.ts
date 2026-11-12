import { createHash, randomBytes } from "node:crypto";
import { prisma } from "#app/utils/db.server.ts";

/** Matches `en_verification` maxAge in verification.server.ts */
export const PASSWORD_RESET_GRANT_MAX_AGE_MS = 60 * 10 * 1000;

export function hashPasswordResetGrantToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createPasswordResetGrantForUser(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashPasswordResetGrantToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_GRANT_MAX_AGE_MS);

  await prisma.$transaction(async ($tx) => {
    await $tx.passwordResetGrant.deleteMany({ where: { userId } });
    await $tx.passwordResetGrant.create({
      data: { tokenHash, userId, expiresAt },
    });
  });

  return { token, expiresAt };
}

export class InvalidPasswordResetGrantError extends Error {
  constructor() {
    super("Invalid or expired password reset grant");
    this.name = "InvalidPasswordResetGrantError";
  }
}
