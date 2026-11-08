import { parseString } from "set-cookie-parser";
import { describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./discover.index.tsx";

async function createUserCookie() {
  const user = await prisma.user.create({ data: createUser() });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expirationDate: getSessionExpirationDate(),
    },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return `${parsedCookie.name}=${parsedCookie.value}`;
}

describe("discover index loader", () => {
  test("returns 400 for a malformed cursor", async () => {
    const cookie = await createUserCookie();
    const request = new Request("http://localhost/discover?cursor=" + "x".repeat(201), {
      headers: { cookie },
    });

    await expect(
      loader({ request, url: new URL(request.url), params: {}, context: {} } as never),
    ).rejects.toSatisfy(
      (err: unknown) =>
        typeof err === "object" &&
        err !== null &&
        "init" in err &&
        (err as { init?: { status?: number } }).init?.status === 400,
    );
  });
});
