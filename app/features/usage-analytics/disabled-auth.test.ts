import { beforeEach, describe, expect, test } from "vitest";
import { parseString } from "set-cookie-parser";
import { getSessionExpirationDate, getUserId, login, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createPassword, createUser } from "#tests/db-utils.ts";
import { disableUser } from "./admin-users.server.ts";

describe("disabled user auth", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.dailyActiveUser.deleteMany();
    await prisma.dailyUsageStat.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });
  });

  test("login returns disabled for disabled accounts", async () => {
    const userData = createUser();
    const password = "kodylovesyou";
    const user = await prisma.user.create({
      data: {
        ...userData,
        password: { create: createPassword(password) },
        roles: { connect: { name: "user" } },
      },
    });
    await disableUser(user.id);

    const result = await login({ username: user.username, password });
    expect(result).toEqual({ status: "disabled" });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  test("getUserId destroys session for disabled users", async () => {
    const user = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: { name: "user" } },
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        expirationDate: getSessionExpirationDate(),
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { disabledAt: new Date() },
    });

    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, session.id);
    const setCookieHeader = await authSessionStorage.commitSession(authSession);
    const parsedCookie = parseString(setCookieHeader)!;
    const cookie = `${parsedCookie.name}=${parsedCookie.value}`;

    const request = new Request("http://localhost/", {
      headers: { cookie },
    });

    try {
      await getUserId(request);
      expect.unreachable("expected redirect for disabled user");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
    }
  });
});
