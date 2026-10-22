import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./$id.tsx";

describe("GET /api/artists/:id", () => {
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

  function loadRequest(cookie: string, id: string) {
    return new Request(`http://localhost/api/artists/${id}`, { headers: { cookie } });
  }

  test("returns the artist name for an id", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: {
        name: `Meryl ${stamp}`,
        normalizedName: `meryl ${stamp}`,
      },
    });
    createdIds.push(artist.id);

    const response = await loader({
      request: loadRequest(cookie, artist.id),
      params: { id: artist.id },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      artist: { id: string; name: string; trackCount: number } | null;
    };
    expect(body.artist).toEqual({
      id: artist.id,
      name: `Meryl ${stamp}`,
      trackCount: 0,
    });
  });

  test("returns a merged artist so the stored id can still be displayed", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const target = await prisma.artist.create({
      data: {
        name: `Canonical ${stamp}`,
        normalizedName: `canonical ${stamp}`,
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Alias ${stamp}`,
        normalizedName: `alias ${stamp}`,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const response = await loader({
      request: loadRequest(cookie, source.id),
      params: { id: source.id },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { artist: { id: string; name: string } | null };
    expect(body.artist).toMatchObject({ id: source.id, name: `Alias ${stamp}` });
  });

  test("returns 404 when the artist does not exist", async () => {
    const cookie = await createUserCookie();
    const response = await loader({
      request: loadRequest(cookie, "missing-artist"),
      params: { id: "missing-artist" },
      context: {},
    } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { artist: null };
    expect(body.artist).toBeNull();
  });

  test("rejects unauthenticated requests", async () => {
    await expect(
      loader({
        request: new Request("http://localhost/api/artists/missing-artist"),
        params: { id: "missing-artist" },
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
  });
});
