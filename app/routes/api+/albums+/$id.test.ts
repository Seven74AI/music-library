import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./$id.tsx";

describe("GET /api/albums/:id", () => {
  const artistIds: string[] = [];
  const albumIds: string[] = [];
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
    if (albumIds.length) {
      await prisma.album.deleteMany({ where: { id: { in: albumIds } } });
      albumIds.length = 0;
    }
    if (artistIds.length) {
      await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
      artistIds.length = 0;
    }
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
    return new Request(`http://localhost/api/albums/${id}`, { headers: { cookie } });
  }

  test("returns the album name, artist, and year for an id", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: { name: `Miles ${stamp}`, normalizedName: `miles ${stamp}` },
    });
    const album = await prisma.album.create({
      data: { name: `Kind of Blue ${stamp}`, artistId: artist.id, year: 1959 },
    });
    artistIds.push(artist.id);
    albumIds.push(album.id);

    const response = await loader({
      request: loadRequest(cookie, album.id),
      params: { id: album.id },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      album: {
        id: string;
        name: string;
        artistName: string;
        year: number | null;
        trackCount: number;
      } | null;
    };
    expect(body.album).toEqual({
      id: album.id,
      name: `Kind of Blue ${stamp}`,
      artistName: `Miles ${stamp}`,
      year: 1959,
      trackCount: 0,
    });
  });

  test("returns a merged album so the stored id can still be displayed", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: { name: `Artist ${stamp}`, normalizedName: `artist ${stamp}` },
    });
    const target = await prisma.album.create({
      data: { name: `Canonical ${stamp}`, artistId: artist.id },
    });
    const source = await prisma.album.create({
      data: {
        name: `Alias ${stamp}`,
        artistId: artist.id,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    artistIds.push(artist.id);
    albumIds.push(source.id, target.id);

    const response = await loader({
      request: loadRequest(cookie, source.id),
      params: { id: source.id },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { album: { id: string; name: string } | null };
    expect(body.album).toMatchObject({ id: source.id, name: `Alias ${stamp}` });
  });

  test("returns 404 when the album does not exist", async () => {
    const cookie = await createUserCookie();
    const response = await loader({
      request: loadRequest(cookie, "missing-album"),
      params: { id: "missing-album" },
      context: {},
    } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { album: null };
    expect(body.album).toBeNull();
  });

  test("rejects unauthenticated requests", async () => {
    await expect(
      loader({
        request: new Request("http://localhost/api/albums/missing-album"),
        params: { id: "missing-album" },
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
  });
});
