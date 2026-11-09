import { parseString } from "set-cookie-parser";
import { afterEach, describe, expect, test } from "vitest";
import { twoFAVerificationType } from "#app/routes/settings+/profile.two-factor.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { encryptVerificationSecret } from "#app/utils/token-cipher.server.ts";
import { generateTOTP } from "#app/utils/totp.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { convertSetCookieToCookie } from "#tests/utils.ts";
import { setPendingVerification } from "./verify-pending.server.ts";
import { action } from "./verify.tsx";

const createdUserIds: string[] = [];
const UNVERIFIED_SESSION_ID_KEY = "unverified-session-id";

async function createAccount() {
  const user = await prisma.user.create({ data: createUser() });
  createdUserIds.push(user.id);
  return user;
}

async function enableTwoFA(userId: string) {
  const { otp, ...config } = await generateTOTP();
  await prisma.verification.create({
    data: {
      ...config,
      secret: encryptVerificationSecret(config.secret),
      type: twoFAVerificationType,
      target: userId,
    },
  });
  return otp;
}

async function createPendingSession(userId: string) {
  return prisma.session.create({
    data: {
      userId,
      expirationDate: getSessionExpirationDate(),
    },
    select: { id: true },
  });
}

async function verifyCookie(values: Record<string, unknown>) {
  const verifySession = await verifySessionStorage.getSession();
  for (const [key, value] of Object.entries(values)) {
    verifySession.set(key, value);
  }
  return convertSetCookieToCookie(await verifySessionStorage.commitSession(verifySession));
}

async function readAuthSessionId(response: Response) {
  const sessionCookie = response.headers
    .getSetCookie()
    .find((cookie) => parseString(cookie)?.name === "en_session");
  if (!sessionCookie) return null;
  const authSession = await authSessionStorage.getSession(convertSetCookieToCookie(sessionCookie));
  return (authSession.get(sessionKey) as string | undefined) ?? null;
}

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  if (userIds.length === 0) return;
  await prisma.verification.deleteMany({ where: { target: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("verify action session cookies", () => {
  test("session-backed 2FA confirm promotes the pending login without clobbering en_session", async () => {
    const user = await createAccount();
    const otp = await enableTwoFA(user.id);
    const pending = await createPendingSession(user.id);
    const verifySessionCookie = await verifyCookie({ [UNVERIFIED_SESSION_ID_KEY]: pending.id });

    const authSession = await authSessionStorage.getSession();
    setPendingVerification(authSession, {
      code: otp,
      type: "2fa",
      target: user.id,
      redirectTo: "/library",
    });
    const authCookie = convertSetCookieToCookie(
      await authSessionStorage.commitSession(authSession),
    );

    const response = await action({
      request: new Request("http://localhost/verify", {
        method: "POST",
        headers: { cookie: `${authCookie}; ${verifySessionCookie}` },
        body: new FormData(),
      }),
      params: {},
      context: {},
    } as Parameters<typeof action>[0]);

    expect(response).toBeInstanceOf(Response);
    const redirect = response as Response;
    expect(redirect).toHaveRedirect("/library");
    expect(await readAuthSessionId(redirect)).toBe(pending.id);

    const sessionCookie = redirect.headers
      .getSetCookie()
      .find((cookie) => parseString(cookie)?.name === "en_session");
    expect(sessionCookie).toBeTruthy();
    const clearedSession = await authSessionStorage.getSession(
      convertSetCookieToCookie(sessionCookie!),
    );
    expect(clearedSession.get("pendingVerification")).toBeUndefined();
    expect(clearedSession.get(sessionKey)).toBe(pending.id);
  });
});
