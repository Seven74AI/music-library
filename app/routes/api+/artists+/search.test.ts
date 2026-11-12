import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { normalizeArtistName } from "#app/utils/normalize.server.ts";
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

  test("resolves The Beatles and AC/DC using normalizedName", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const beatlesName = `The Beatles ${stamp}`;
    const acdcName = `AC/DC ${stamp}`;
    const beatles = await prisma.artist.create({
      data: {
        name: beatlesName,
        normalizedName: normalizeArtistName(beatlesName),
      },
    });
    const acdc = await prisma.artist.create({
      data: {
        name: acdcName,
        normalizedName: normalizeArtistName(acdcName),
      },
    });
    createdIds.push(beatles.id, acdc.id);

    const beatlesResponse = await loader({
      request: new Request(
        `http://localhost/api/artists/search?q=${encodeURIComponent(`The Beatles ${stamp}`)}`,
        { headers: { cookie } },
      ),
      params: {},
      context: {},
    } as never);
    const beatlesBody = (await beatlesResponse.json()) as {
      artists: Array<{ id: string; name: string }>;
    };
    expect(beatlesBody.artists.map((artist) => artist.id)).toContain(beatles.id);

    const acdcResponse = await loader({
      request: new Request(
        `http://localhost/api/artists/search?q=${encodeURIComponent(`AC/DC ${stamp}`)}`,
        { headers: { cookie } },
      ),
      params: {},
      context: {},
    } as never);
    const acdcBody = (await acdcResponse.json()) as {
      artists: Array<{ id: string; name: string }>;
    };
    expect(acdcBody.artists.map((artist) => artist.id)).toContain(acdc.id);
  });

  test("returns no rows when normalization yields an empty query", async () => {
    const cookie = await createUserCookie();
    const response = await loader({
      request: new Request("http://localhost/api/artists/search?q=!!!", { headers: { cookie } }),
      params: {},
      context: {},
    } as never);
    const body = (await response.json()) as { artists: unknown[] };
    expect(body.artists).toEqual([]);
  });

  test("does not return artists that have been merged into another artist", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetName = `Search Target ${stamp}`;
    const target = await prisma.artist.create({
      data: {
        name: targetName,
        normalizedName: normalizeArtistName(targetName),
      },
    });
    const sourceName = `Search Alias ${stamp}`;
    const source = await prisma.artist.create({
      data: {
        name: sourceName,
        normalizedName: normalizeArtistName(sourceName),
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const response = await loader({
      request: new Request(
        `http://localhost/api/artists/search?q=${encodeURIComponent(targetName)}`,
        { headers: { cookie } },
      ),
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
    const artistName = `100% Sure ${stamp}`;
    const artist = await prisma.artist.create({
      data: {
        name: artistName,
        normalizedName: normalizeArtistName(artistName),
      },
    });
    createdIds.push(artist.id);

    const response = await loader({
      request: new Request(
        `http://localhost/api/artists/search?q=${encodeURIComponent(artistName)}`,
        { headers: { cookie } },
      ),
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
