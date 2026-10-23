import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./search.tsx";

describe("GET /api/artists/search", () => {
  const createdIds: string[] = [];
  const userIds: string[] = [];
  const sessionIds: string[] = [];

  beforeEach(async () => {
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });
  });

  afterEach(async () => {
    if (sessionIds.length) {
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
      sessionIds.length = 0;
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      userIds.length = 0;
    }
    if (createdIds.length === 0) return;
    await prisma.artist.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  });

  async function createUserCookie() {
    const user = await prisma.user.create({
      data: { ...createUser(), roles: { connect: { name: "user" } } },
    });
    const session = await prisma.session.create({
      data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    });
    userIds.push(user.id);
    sessionIds.push(session.id);
    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, session.id);
    const setCookieHeader = await authSessionStorage.commitSession(authSession);
    const parsedCookie = parseString(setCookieHeader)!;
    return `${parsedCookie.name}=${parsedCookie.value}`;
  }

  test("does not return artists that have been merged into another artist", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const target = await prisma.artist.create({
      data: {
        name: `Search Target ${stamp}`,
        normalizedName: `search target ${stamp}`,
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Search Alias ${stamp}`,
        normalizedName: `search alias ${stamp}`,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const response = await loader({
      request: new Request(`http://localhost/api/artists/search?q=${encodeURIComponent(stamp)}`, {
        headers: { cookie },
      }),
      params: {},
      context: {},
    } as never);

    const body = (await response.json()) as {
      artists: Array<{ id: string; name: string }>;
    };
    const ids = body.artists.map((artist) => artist.id);

    expect(ids).not.toContain(source.id);
    expect(ids).toContain(target.id);
  });

  test("treats LIKE wildcards literally", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: {
        name: `100% Sure ${stamp}`,
        normalizedName: `100% sure ${stamp}`,
      },
    });
    createdIds.push(artist.id);

    // A bare '%' must not match every artist — only names containing a literal '%'.
    const response = await loader({
      request: new Request("http://localhost/api/artists/search?q=%25", { headers: { cookie } }),
      params: {},
      context: {},
    } as never);
    const body = (await response.json()) as { artists: Array<{ id: string; name: string }> };
    expect(body.artists.map((item) => item.id)).toContain(artist.id);
  });

  test("rejects unauthenticated requests", async () => {
    await expect(
      loader({
        request: new Request("http://localhost/api/artists/search?q=anything"),
        params: {},
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
  });
});
