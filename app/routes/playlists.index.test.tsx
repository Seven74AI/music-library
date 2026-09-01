import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader as playlistsLoader } from "./playlists.index.tsx";

type PlaylistRow = {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  tracks: Array<{ id: string; position: number; track: { id: string; title: string } }>;
};

type LoaderData = {
  playlists: PlaylistRow[];
  pagination: { limit: number; hasNext: boolean; nextCursor: string | null };
  sort: string;
  q: string;
};

async function createUserCookie() {
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
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return {
    userId: user.id,
    cookie: `${parsedCookie.name}=${parsedCookie.value}`,
  };
}

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

async function createTrack(title: string) {
  const service = await ensureLocalService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.track.create({
    data: {
      title: `${title} ${suffix}`,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: {
          name: `Artist ${suffix}`,
          normalizedName: `artist ${suffix}`,
        },
      },
    },
  });
}

async function createPlaylist({
  userId,
  title,
  description = null,
  createdAt,
  updatedAt,
  trackCount = 0,
}: {
  userId: string;
  title: string;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  trackCount?: number;
}) {
  const playlist = await prisma.userPlaylist.create({
    data: {
      title,
      description,
      ownerId: userId,
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    },
  });

  if (trackCount > 0) {
    const links = [];
    for (let i = 0; i < trackCount; i++) {
      const track = await createTrack(`${title} track ${i}`);
      links.push({ playlistId: playlist.id, trackId: track.id, position: i + 1 });
    }
    await prisma.userPlaylistTrack.createMany({ data: links });
  }

  return playlist;
}

function pageRequest(cookie: string, url = "http://localhost/playlists") {
  const request = new Request(url, { headers: { cookie } });
  return { request, url: new URL(request.url), params: {}, context: {} };
}

function readData(response: unknown): LoaderData {
  return (response as { data: LoaderData }).data;
}

const T0 = new Date("2026-09-01T10:00:00.000Z");

function at(seconds: number) {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("playlists index loader", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });
  });

  test("redirects unauthenticated requests", async () => {
    await expect(playlistsLoader(pageRequest("") as never)).rejects.toBeInstanceOf(Response);
  });

  test("sorts by updatedAt desc by default", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "Oldest", updatedAt: at(10) });
    await createPlaylist({ userId, title: "Newest", updatedAt: at(30) });
    await createPlaylist({ userId, title: "Middle", updatedAt: at(20) });

    const { playlists } = readData(await playlistsLoader(pageRequest(cookie) as never));

    expect(playlists.map((p) => p.title)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  test("sorts by name ascending", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "Bravo" });
    await createPlaylist({ userId, title: "Alpha" });
    await createPlaylist({ userId, title: "Charlie" });

    const { playlists } = readData(
      await playlistsLoader(pageRequest(cookie, "http://localhost/playlists?sort=name") as never),
    );

    expect(playlists.map((p) => p.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  test("sorts by createdAt descending", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "First", createdAt: at(10) });
    await createPlaylist({ userId, title: "Last", createdAt: at(30) });
    await createPlaylist({ userId, title: "Second", createdAt: at(20) });

    const { playlists } = readData(
      await playlistsLoader(
        pageRequest(cookie, "http://localhost/playlists?sort=created") as never,
      ),
    );

    expect(playlists.map((p) => p.title)).toEqual(["Last", "Second", "First"]);
  });

  test("sorts by track count descending", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "Empty", trackCount: 0 });
    await createPlaylist({ userId, title: "Big", trackCount: 3 });
    await createPlaylist({ userId, title: "Small", trackCount: 1 });

    const { playlists } = readData(
      await playlistsLoader(pageRequest(cookie, "http://localhost/playlists?sort=tracks") as never),
    );

    expect(playlists.map((p) => p.title)).toEqual(["Big", "Small", "Empty"]);
  });

  test("filters by q across title and description", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "Rock Classics" });
    await createPlaylist({ userId, title: "Jazz", description: "Smooth rock instrumentals" });
    await createPlaylist({ userId, title: "Ambient" });

    const { playlists } = readData(
      await playlistsLoader(
        pageRequest(cookie, "http://localhost/playlists?q=rock&sort=name") as never,
      ),
    );

    expect(playlists.map((p) => p.title)).toEqual(["Jazz", "Rock Classics"]);
  });

  test("composes sort and q together", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "Rock Bravo" });
    await createPlaylist({ userId, title: "Rock Alpha" });
    await createPlaylist({ userId, title: "Pop Alpha" });

    const { playlists } = readData(
      await playlistsLoader(
        pageRequest(cookie, "http://localhost/playlists?q=rock&sort=name") as never,
      ),
    );

    expect(playlists.map((p) => p.title)).toEqual(["Rock Alpha", "Rock Bravo"]);
  });

  test("cursor-paginates without overlap or gaps", async () => {
    const { userId, cookie } = await createUserCookie();
    // Names sorted ascending: A, B, C, D, E.
    const created = [];
    for (const title of ["A", "B", "C", "D", "E"]) {
      created.push(await createPlaylist({ userId, title }));
    }

    const page1 = readData(
      await playlistsLoader(
        pageRequest(cookie, "http://localhost/playlists?sort=name&limit=2") as never,
      ),
    );
    expect(page1.playlists.map((p) => p.title)).toEqual(["A", "B"]);
    expect(page1.pagination.hasNext).toBe(true);
    expect(page1.pagination.nextCursor).not.toBeNull();

    const page2 = readData(
      await playlistsLoader(
        pageRequest(
          cookie,
          `http://localhost/playlists?sort=name&limit=2&cursor=${page1.pagination.nextCursor}`,
        ) as never,
      ),
    );
    expect(page2.playlists.map((p) => p.title)).toEqual(["C", "D"]);
    expect(page2.pagination.hasNext).toBe(true);

    const page3 = readData(
      await playlistsLoader(
        pageRequest(
          cookie,
          `http://localhost/playlists?sort=name&limit=2&cursor=${page2.pagination.nextCursor}`,
        ) as never,
      ),
    );
    expect(page3.playlists.map((p) => p.title)).toEqual(["E"]);
    expect(page3.pagination.hasNext).toBe(false);
    expect(page3.pagination.nextCursor).toBeNull();

    const allIds = [...page1.playlists, ...page2.playlists, ...page3.playlists].map((p) => p.id);
    expect(new Set(allIds).size).toBe(created.length);
  });

  test("cursor pagination respects an active filter", async () => {
    const { userId, cookie } = await createUserCookie();
    await createPlaylist({ userId, title: "Keep A" });
    await createPlaylist({ userId, title: "Keep B" });
    await createPlaylist({ userId, title: "Keep C" });
    await createPlaylist({ userId, title: "Skip D" });

    const page1 = readData(
      await playlistsLoader(
        pageRequest(cookie, "http://localhost/playlists?q=keep&sort=name&limit=2") as never,
      ),
    );
    expect(page1.playlists.map((p) => p.title)).toEqual(["Keep A", "Keep B"]);
    expect(page1.pagination.hasNext).toBe(true);

    const page2 = readData(
      await playlistsLoader(
        pageRequest(
          cookie,
          `http://localhost/playlists?q=keep&sort=name&limit=2&cursor=${page1.pagination.nextCursor}`,
        ) as never,
      ),
    );
    expect(page2.playlists.map((p) => p.title)).toEqual(["Keep C"]);
    expect(page2.pagination.hasNext).toBe(false);
  });
});
