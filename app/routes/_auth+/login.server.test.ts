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
import { validateRequest } from "./verify.server.ts";

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
  const setCookie = await verifySessionStorage.commitSession(verifySession);
  return convertSetCookieToCookie(setCookie);
}

async function authCookieForSession(sessionId: string) {
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, sessionId);
  return convertSetCookieToCookie(await authSessionStorage.commitSession(authSession));
}

function verifyBody(values: { code: string; target: string; redirectTo?: string }) {
  return new URLSearchParams({
    code: values.code,
    type: twoFAVerificationType,
    target: values.target,
    redirectTo: values.redirectTo ?? "/library",
  });
}

async function runValidateRequest(request: Request, body: URLSearchParams) {
  try {
    return await validateRequest(request, body);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
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

describe("login 2FA binds the OTP target to the pending session", () => {
  test("does not promote a pending session when the OTP belongs to a different account", async () => {
    const victim = await createAccount();
    const attacker = await createAccount();
    await enableTwoFA(victim.id);
    const attackerOtp = await enableTwoFA(attacker.id);
    const pending = await createPendingSession(victim.id);
    const cookie = await verifyCookie({ [UNVERIFIED_SESSION_ID_KEY]: pending.id });

    const result = await runValidateRequest(
      new Request("http://localhost/verify", {
        method: "POST",
        headers: { cookie },
      }),
      verifyBody({ code: attackerOtp, target: attacker.id }),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect("/login");
    expect(await readAuthSessionId(response)).toBeNull();
  });

  test("promotes the pending session when the OTP belongs to that same account", async () => {
    const user = await createAccount();
    const otp = await enableTwoFA(user.id);
    const pending = await createPendingSession(user.id);
    const cookie = await verifyCookie({ [UNVERIFIED_SESSION_ID_KEY]: pending.id });

    const result = await runValidateRequest(
      new Request("http://localhost/verify", {
        method: "POST",
        headers: { cookie },
      }),
      verifyBody({ code: otp, target: user.id }),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect("/library");
    expect(await readAuthSessionId(response)).toBe(pending.id);
  });
});

describe("reverify 2FA binds the OTP target to the signed-in user", () => {
  test("does not mark the signed-in session verified when the OTP belongs to a different account", async () => {
    const signedIn = await createAccount();
    const other = await createAccount();
    await enableTwoFA(signedIn.id);
    const otherOtp = await enableTwoFA(other.id);
    const session = await createPendingSession(signedIn.id);
    const cookie = await authCookieForSession(session.id);

    const result = await runValidateRequest(
      new Request("http://localhost/verify", {
        method: "POST",
        headers: { cookie },
      }),
      verifyBody({ code: otherOtp, target: other.id }),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect("/login");
    expect(await readAuthSessionId(response)).toBeNull();
  });
});
