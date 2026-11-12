import { describe, expect, test } from "vitest";
import { WEBAUTHN_CLIENT_ERROR_MESSAGE, toWebAuthnClientErrorMessage } from "./utils.server.ts";

describe("toWebAuthnClientErrorMessage", () => {
  test("keeps intentional passkey user messages", () => {
    expect(toWebAuthnClientErrorMessage(new Error("Passkey not found"))).toBe("Passkey not found");
  });

  test("does not return raw Prisma or provider text", () => {
    const prismaLeak = new Error(
      "Invalid `prisma.passkey.create()` invocation: Unique constraint failed",
    );
    expect(toWebAuthnClientErrorMessage(prismaLeak)).toBe(WEBAUTHN_CLIENT_ERROR_MESSAGE);
    expect(toWebAuthnClientErrorMessage(prismaLeak)).not.toMatch(/prisma/i);
  });
});
