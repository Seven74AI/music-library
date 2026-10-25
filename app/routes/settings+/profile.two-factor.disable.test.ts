import { parseString } from "set-cookie-parser";
import { afterEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { toastKey, toastSessionStorage } from "#app/utils/toast.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { convertSetCookieToCookie } from "#tests/utils.ts";
import { action, loader } from "./profile.two-factor.disable.tsx";
import { twoFAVerificationType } from "./profile.two-factor.tsx";

const DISABLE_PATH = "/settings/profile/two-factor/disable";
const TWO_FA_INDEX = "/settings/profile/two-factor";
/** Same key `shouldRequestTwoFA` reads. A recent value skips the reverify redirect. */
const VERIFIED_TIME_KEY = "verified-time";

const createdUserIds: string[] = [];

function databaseErrorText(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "";
}

async function createAccount({ recentlyVerified = false } = {}) {
  const user = await prisma.user.create({ data: createUser() });
  createdUserIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expirationDate: getSessionExpirationDate(),
    },
    select: { id: true },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  if (recentlyVerified) {
    authSession.set(VERIFIED_TIME_KEY, Date.now());
  }
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return {
    userId: user.id,
    cookie: `${parsedCookie.name}=${parsedCookie.value}`,
  };
}

async function createVerification(target: string, type: string) {
  return prisma.verification.create({
    data: {
      type,
      target,
      secret: "enc1:test-secret",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      charSet: "1234567890",
    },
  });
}

function disableRequest(cookie: string) {
  return new Request(`http://localhost${DISABLE_PATH}`, {
    method: "POST",
    headers: { cookie },
  });
}

function callLoader(cookie: string) {
  const request = new Request(`http://localhost${DISABLE_PATH}`, {
    headers: { cookie },
  });
  return loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: DISABLE_PATH,
  });
}

function callAction(cookie: string) {
  const request = disableRequest(cookie);
  return action({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: DISABLE_PATH,
  });
}

async function readToast(response: Response) {
  const toastSetCookie = response.headers
    .getSetCookie()
    .find((cookie) => parseString(cookie)?.name === "en_toast");
  if (!toastSetCookie) return null;
  const toastSession = await toastSessionStorage.getSession(
    convertSetCookieToCookie(toastSetCookie),
  );
  const toast = toastSession.get(toastKey);
  if (!toast || typeof toast !== "object") return null;
  const { title, description, type } = toast as {
    title?: string;
    description?: string;
    type?: string;
  };
  return { title, description, type };
}

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  if (userIds.length === 0) return;
  await prisma.verification.deleteMany({ where: { target: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("disable 2FA when it is not enabled", () => {
  test("loader redirects to the 2FA index", async () => {
    const { cookie } = await createAccount();

    const result = await callLoader(cookie);

    expect(result).toBeInstanceOf(Response);
    expect(result).toHaveRedirect(TWO_FA_INDEX);
  });

  test("action does not throw a database error and redirects to the 2FA index", async () => {
    const { userId, cookie } = await createAccount();

    const result = await callAction(cookie).catch((error: unknown) => error);

    expect(databaseErrorText(result)).not.toMatch(/prisma|P2025|Record to delete|does not exist/i);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).not.toBe(500);
    expect(response).toHaveRedirect(TWO_FA_INDEX);
    expect(await response.clone().text()).not.toMatch(/prisma|P2025|Record to delete/i);
    expect(await readToast(response)).toBeNull();
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: userId, type: twoFAVerificationType } },
      }),
    ).toBeNull();
  });
});

describe("disable 2FA when it is enabled", () => {
  test("loader renders the disable page", async () => {
    const { userId, cookie } = await createAccount({ recentlyVerified: true });
    await createVerification(userId, twoFAVerificationType);

    const result = await callLoader(cookie);

    expect(result).toEqual({});
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: userId, type: twoFAVerificationType } },
      }),
    ).not.toBeNull();
  });

  test("action deletes the 2FA verification and confirms it", async () => {
    const { userId, cookie } = await createAccount({ recentlyVerified: true });
    await createVerification(userId, twoFAVerificationType);
    const unrelated = await createVerification(userId, "onboarding");

    const result = await callAction(cookie);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect(TWO_FA_INDEX);
    expect(await readToast(response)).toEqual({
      title: "2FA Disabled",
      description: "Two factor authentication has been disabled.",
      type: "message",
    });
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: userId, type: twoFAVerificationType } },
      }),
    ).toBeNull();
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: userId, type: unrelated.type } },
      }),
    ).not.toBeNull();
  });
});
