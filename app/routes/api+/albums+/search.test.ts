import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./search.tsx";

describe("GET /api/albums/search", () => {
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

  async function createAlbum(name: string, artistName: string, year?: number) {
    const artist = await prisma.artist.create({
      data: {
        name: artistName,
        normalizedName: artistName.toLowerCase(),
      },
    });
    artistIds.push(artist.id);
    const album = await prisma.album.create({
      data: {
        name,
        artistId: artist.id,
        year,
      },
    });
    albumIds.push(album.id);
    return { artist, album };
  }

  async function search(query: string, cookie: string) {
    const response = await loader({
      request: new Request(`http://localhost/api/albums/search?q=${encodeURIComponent(query)}`, {
        headers: { cookie },
      }),
      params: {},
      context: {},
    } as never);
    return (await response.json()) as {
      albums: Array<{
        id: string;
        name: string;
        artistName: string;
        year: number | null;
        trackCount: number;
      }>;
    };
  }

  test("returns albums whose name contains the query, with artist and year", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { album } = await createAlbum(`Blue Note ${stamp}`, `Miles ${stamp}`, 1959);

    const body = await search(`blue note ${stamp}`, cookie);

    expect(body.albums).toEqual([
      {
        id: album.id,
        name: `Blue Note ${stamp}`,
        artistName: `Miles ${stamp}`,
        year: 1959,
        trackCount: 0,
      },
    ]);
  });

  test("matches album names case-insensitively", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { album } = await createAlbum(`Kind Of Blue ${stamp}`, `Miles ${stamp}`);

    const body = await search(stamp.toUpperCase(), cookie);

    expect(body.albums.map((item) => item.id)).toContain(album.id);
  });

  test("matches the album artist name", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { album } = await createAlbum(`Untitled ${stamp}`, `Search Artist ${stamp}`);

    const body = await search(`search artist ${stamp}`, cookie);

    expect(body.albums.map((item) => item.id)).toEqual([album.id]);
  });

  test("does not return albums that have been merged into another album", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { artist, album: target } = await createAlbum(`Canonical ${stamp}`, `Artist ${stamp}`);
    const source = await prisma.album.create({
      data: {
        name: `Alias ${stamp}`,
        artistId: artist.id,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    albumIds.push(source.id);

    const body = await search(stamp, cookie);
    const ids = body.albums.map((album) => album.id);

    expect(ids).toContain(target.id);
    expect(ids).not.toContain(source.id);
  });

  test("returns no albums for an empty or oversized query", async () => {
    const cookie = await createUserCookie();
    const empty = await loader({
      request: new Request("http://localhost/api/albums/search?q=", { headers: { cookie } }),
      params: {},
      context: {},
    } as never);
    const tooLong = await loader({
      request: new Request(`http://localhost/api/albums/search?q=${"a".repeat(101)}`, {
        headers: { cookie },
      }),
      params: {},
      context: {},
    } as never);

    expect(await empty.json()).toEqual({ albums: [] });
    expect(await tooLong.json()).toEqual({ albums: [] });
  });

  test("treats LIKE wildcards literally", async () => {
    const cookie = await createUserCookie();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { album } = await createAlbum(`100% Sure ${stamp}`, `Artist ${stamp}`);

    // A bare '%' must not match every album — only names containing a literal '%'.
    const wildcard = await search("%", cookie);
    expect(wildcard.albums.map((item) => item.id)).toContain(album.id);

    // A bare '_' must not match every 1-char name — the stamp names have none.
    const underscore = await search("_", cookie);
    expect(underscore.albums.map((item) => item.id)).not.toContain(album.id);
  });

  test("rejects unauthenticated requests", async () => {
    await expect(
      loader({
        request: new Request("http://localhost/api/albums/search?q=anything"),
        params: {},
        context: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);
  });
});
