import { parseString } from "set-cookie-parser";
import { beforeEach, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader, parsePageParam } from "./users.tsx";

async function createAdminCookie() {
  const admin = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: { where: { name: "admin" }, create: { name: "admin" } },
      },
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: { expirationDate: getSessionExpirationDate(), userId: admin.id },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsedCookie = parseString(await authSessionStorage.commitSession(authSession))!;
  return `${parsedCookie.name}=${parsedCookie.value}`;
}

function loadUsers(cookie: string, search = "") {
  const request = new Request(`http://localhost/admin/users${search}`, {
    headers: { cookie },
  });
  return loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin/users",
  });
}

beforeEach(async () => {
  await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin", description: "Admin" },
  });
});

test.each([
  ["missing", null, 1],
  ["non-numeric", "abc", 1],
  ["empty", "", 1],
  ["negative", "-5", 1],
  ["fractional", "2.5", 1],
  ["valid", "3", 3],
])("parsePageParam falls back to 1 for %s input", (_label, raw, expected) => {
  expect(parsePageParam(raw)).toBe(expected);
});

test("loader survives a non-numeric page param instead of throwing", async () => {
  const cookie = await createAdminCookie();

  const data = await loadUsers(cookie, "?page=abc");

  expect(data.page).toBe(1);
  expect(Array.isArray(data.users)).toBe(true);
});

test("loader filters users by search query", async () => {
  const cookie = await createAdminCookie();
  const target = await prisma.user.create({
    data: { ...createUser(), username: `needle${Date.now().toString(36)}` },
  });

  const data = await loadUsers(cookie, `?q=${target.username}`);

  expect(data.users.map((user) => user.username)).toEqual([target.username]);
  expect(data.q).toBe(target.username);
});
