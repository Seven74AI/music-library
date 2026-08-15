import { parseString } from "set-cookie-parser";
import { expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./index.tsx";

async function createAdminCookie() {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return `${parsedCookie.name}=${parsedCookie.value}`;
}

test("admin overview loader returns totals and 30-day series", async () => {
  const cookie = await createAdminCookie();
  const request = new Request("http://localhost/admin", {
    headers: { cookie },
  });

  const data = await loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin",
  });

  expect(data.totals.users).toBeGreaterThanOrEqual(1);
  expect(data.series.signups).toHaveLength(30);
  expect(data.series.dau).toHaveLength(30);
  expect(data.series.playsStarted).toHaveLength(30);
});
