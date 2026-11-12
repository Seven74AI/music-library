import { parseString } from "set-cookie-parser";
import { afterEach, expect, test } from "vitest";
import { getPasswordHash, getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action } from "./profile.password.tsx";

const createdUserIds: string[] = [];

async function accountWithSessions() {
  const password = "not-a-common-password-abc";
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      password: { create: { hash: await getPasswordHash(password) } },
    },
  });
  createdUserIds.push(user.id);
  const currentSession = await prisma.session.create({
    data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    select: { id: true },
  });
  const otherSession = await prisma.session.create({
    data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    select: { id: true },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, currentSession.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return {
    userId: user.id,
    password,
    currentSessionId: currentSession.id,
    otherSessionId: otherSession.id,
    cookie: `${parsedCookie.name}=${parsedCookie.value}`,
  };
}

function changePasswordRequest(cookie: string, currentPassword: string, newPassword: string) {
  const formData = new FormData();
  formData.set("currentPassword", currentPassword);
  formData.set("newPassword", newPassword);
  formData.set("confirmNewPassword", newPassword);
  return new Request("http://localhost/settings/profile/password", {
    method: "POST",
    headers: { cookie },
    body: formData,
  });
}

afterEach(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.password.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

test("password change revokes other sessions but keeps the current session", async () => {
  const account = await accountWithSessions();

  await action({
    request: changePasswordRequest(account.cookie, account.password, "another-strong-password-xyz"),
    params: {},
    context: {},
  } as never);

  const sessions = await prisma.session.findMany({
    where: { userId: account.userId },
    select: { id: true },
  });
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.id).toBe(account.currentSessionId);
});
