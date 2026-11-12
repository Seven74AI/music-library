import { afterEach, describe, expect, test } from "vitest";
import { codeQueryParam, targetQueryParam, typeQueryParam } from "#app/routes/_auth+/verify.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { encryptVerificationSecret } from "#app/utils/token-cipher.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { convertSetCookieToCookie } from "#tests/utils.ts";
import { twoFAVerificationType } from "./profile.two-factor.tsx";
import { prepareVerification, validateRequest } from "../_auth+/verify.server.ts";

const VERIFIED_TIME_KEY = "verified-time";

const createdUserIds: string[] = [];

async function createAccount() {
  const user = await prisma.user.create({ data: createUser() });
  createdUserIds.push(user.id);
  return user;
}

async function authCookieForUser(userId: string, { recentlyVerified = true } = {}) {
  const session = await prisma.session.create({
    data: {
      userId,
      expirationDate: getSessionExpirationDate(),
    },
    select: { id: true },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  if (recentlyVerified) {
    authSession.set(VERIFIED_TIME_KEY, Date.now());
  } else {
    authSession.set(VERIFIED_TIME_KEY, Date.now() - 1000 * 60 * 60 * 3);
  }
  return convertSetCookieToCookie(await authSessionStorage.commitSession(authSession));
}

function changeEmailBody(values: { code: string; target: string }) {
  const body = new URLSearchParams({
    [codeQueryParam]: values.code,
    [typeQueryParam]: "change-email",
    [targetQueryParam]: values.target,
  });
  return body;
}

async function runValidateRequest(request: Request, body: URLSearchParams) {
  try {
    return await validateRequest(request, body);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  if (userIds.length === 0) return;
  await prisma.verification.deleteMany({ where: { target: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("change-email verification", () => {
  test("rejects completion when the session user does not match the OTP target", async () => {
    const victim = await createAccount();
    const attacker = await createAccount();
    const pendingEmail = `new-${victim.id}@example.com`;

    const { otp } = await prepareVerification({
      period: 10 * 60,
      request: new Request("http://localhost/settings/profile/change-email", {
        headers: { host: "localhost" },
      }),
      type: "change-email",
      target: victim.id,
      pendingEmail,
    });

    const attackerCookie = await authCookieForUser(attacker.id);

    const result = await runValidateRequest(
      new Request("http://localhost/verify", {
        method: "POST",
        headers: { cookie: attackerCookie, host: "localhost" },
      }),
      changeEmailBody({ code: otp, target: victim.id }),
    );

    expect(result).toMatchObject({ init: { status: 403 } });

    const victimAfter = await prisma.user.findUniqueOrThrow({
      where: { id: victim.id },
      select: { email: true },
    });
    expect(victimAfter.email).toBe(victim.email);

    const verificationStillThere = await prisma.verification.findUnique({
      where: { target_type: { target: victim.id, type: "change-email" } },
    });
    expect(verificationStillThere).not.toBeNull();
  });

  test("keeps the change-email verification row when the 2FA window has lapsed", async () => {
    const user = await createAccount();
    const pendingEmail = `new-${user.id}@example.com`;

    const { otp } = await prepareVerification({
      period: 10 * 60,
      request: new Request("http://localhost/settings/profile/change-email", {
        headers: { host: "localhost" },
      }),
      type: "change-email",
      target: user.id,
      pendingEmail,
    });

    await prisma.verification.create({
      data: {
        type: twoFAVerificationType,
        target: user.id,
        secret: encryptVerificationSecret("two-fa-secret"),
        algorithm: "SHA-256",
        digits: 6,
        period: 30,
        charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
      },
    });

    const cookie = await authCookieForUser(user.id, { recentlyVerified: false });

    const result = await runValidateRequest(
      new Request("http://localhost/verify", {
        method: "POST",
        headers: { cookie, host: "localhost" },
      }),
      changeEmailBody({ code: otp, target: user.id }),
    );

    expect(result).toBeInstanceOf(Response);
    const location =
      result instanceof Response
        ? result.headers.get("Location")
        : ((result as { init?: { headers?: Headers } }).init?.headers?.get?.("Location") ?? null);
    expect(location).toMatch(/\/verify/);

    const verificationStillThere = await prisma.verification.findUnique({
      where: { target_type: { target: user.id, type: "change-email" } },
    });
    expect(verificationStillThere).not.toBeNull();

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true },
    });
    expect(userAfter.email).toBe(user.email);
  });
});
