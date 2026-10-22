import { expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action, loader } from "./security-events.tsx";
import { parseString } from "set-cookie-parser";

async function cookieFor(role: "admin" | "user" | null) {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      ...(role
        ? {
            roles: {
              connectOrCreate: { where: { name: role }, create: { name: role } },
            },
          }
        : {}),
    },
  });
  const session = await prisma.session.create({
    data: { expirationDate: getSessionExpirationDate(), userId: user.id },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsed = parseString(await authSessionStorage.commitSession(authSession))!;
  return { userId: user.id, cookie: `${parsed.name}=${parsed.value}` };
}

function callLoader(cookie: string, search = "") {
  const request = new Request(`http://localhost/admin/security-events${search}`, {
    headers: { cookie },
  });
  return loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin/security-events",
  });
}

test("security events loader requires an admin", async () => {
  const { cookie } = await cookieFor("user");
  await expect(callLoader(cookie)).rejects.toMatchObject({
    type: "DataWithResponseInit",
    init: { status: 403 },
  });
});

test("admin loader returns the five tab datasets and force-logout removes a session", async () => {
  const admin = await cookieFor("admin");
  const target = await prisma.user.create({ data: createUser() });
  const session = await prisma.session.create({
    data: { userId: target.id, expirationDate: getSessionExpirationDate() },
  });

  const failed = await callLoader(admin.cookie);
  expect(failed.tab).toBe("failed");
  expect(failed.alerts).toEqual(expect.any(Array));

  const accounts = await callLoader(admin.cookie, "?tab=accounts");
  expect(accounts.tab).toBe("accounts");
  expect(accounts.accountChanges).toEqual(expect.any(Array));

  const timeline = await callLoader(
    admin.cookie,
    "?tab=timeline&eventType=login_failed&username=nobody",
  );
  expect(timeline.tab).toBe("timeline");
  expect(timeline.timeline?.events).toEqual(expect.any(Array));

  const form = new FormData();
  form.set("intent", "logout-session");
  form.set("sessionId", session.id);
  const request = new Request("http://localhost/admin/security-events?tab=sessions", {
    method: "POST",
    body: form,
    headers: { cookie: admin.cookie },
  });
  const response = await action({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin/security-events",
  });
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(302);
  expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
});
