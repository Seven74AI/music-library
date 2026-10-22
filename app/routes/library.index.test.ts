import { parseString } from "set-cookie-parser";
import { afterEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./library.index.tsx";

type LibraryLoaderData = {
  userTracks: Array<{ track: { id: string; title: string } }>;
  genreId: string | null;
  genre: { id: string; name: string } | null;
};

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
  const artist = await prisma.artist.create({
    data: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      serviceId: service.id,
      artistId: artist.id,
    },
  });
}

function pageRequest(cookie: string, url = "http://localhost/library") {
  const request = new Request(url, { headers: { cookie } });
  return { request, url: new URL(request.url), params: {}, context: {} };
}

function readData(response: unknown): LibraryLoaderData {
  return (response as { data: LibraryLoaderData }).data;
}

describe("library index genre filter", () => {
  const userIds: string[] = [];
  const trackIds: string[] = [];
  const genreIds: string[] = [];

  afterEach(async () => {
    if (trackIds.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: trackIds.splice(0) } } });
    }
    if (genreIds.length > 0) {
      await prisma.genre.deleteMany({ where: { id: { in: genreIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  test("returns tracks tagged with the genre and the genre name", async () => {
    const { userId, cookie } = await createUserCookie();
    userIds.push(userId);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tagged = await createTrack("Tagged Jazz");
    const other = await createTrack("Other Genre");
    trackIds.push(tagged.id, other.id);
    const genre = await prisma.genre.create({
      data: {
        name: `Loader Jazz ${suffix}`,
        normalizedName: `loader jazz ${suffix}`,
        tracks: { connect: { id: tagged.id } },
      },
    });
    genreIds.push(genre.id);
    await prisma.userTrack.createMany({
      data: [
        { userId, trackId: tagged.id, createdAt: new Date("2026-02-01T00:00:00.000Z") },
        { userId, trackId: other.id, createdAt: new Date("2026-03-01T00:00:00.000Z") },
      ],
    });

    const body = readData(
      await loader(pageRequest(cookie, `http://localhost/library?genre=${genre.id}`) as never),
    );

    expect(body.genreId).toBe(genre.id);
    expect(body.genre).toEqual({ id: genre.id, name: genre.name });
    expect(body.userTracks.map((row) => row.track.title)).toEqual(["Tagged Jazz"]);
  });

  test("returns an empty list and the genre name when none of the user's tracks match", async () => {
    const { userId, cookie } = await createUserCookie();
    userIds.push(userId);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const other = await createTrack("Unrelated");
    trackIds.push(other.id);
    const genre = await prisma.genre.create({
      data: {
        name: `Loader Empty ${suffix}`,
        normalizedName: `loader empty ${suffix}`,
      },
    });
    genreIds.push(genre.id);
    await prisma.userTrack.create({
      data: { userId, trackId: other.id },
    });

    const body = readData(
      await loader(pageRequest(cookie, `http://localhost/library?genre=${genre.id}`) as never),
    );

    expect(body.genre).toEqual({ id: genre.id, name: genre.name });
    expect(body.userTracks).toEqual([]);
  });

  test("returns no tracks and a null genre when the id does not exist", async () => {
    const { userId, cookie } = await createUserCookie();
    userIds.push(userId);
    const track = await createTrack("Still Here");
    trackIds.push(track.id);
    await prisma.userTrack.create({ data: { userId, trackId: track.id } });

    const body = readData(
      await loader(pageRequest(cookie, "http://localhost/library?genre=missing-genre") as never),
    );

    expect(body.genreId).toBe("missing-genre");
    expect(body.genre).toBeNull();
    expect(body.userTracks).toEqual([]);
  });

  test("ignores a blank genre param", async () => {
    const { userId, cookie } = await createUserCookie();
    userIds.push(userId);
    const track = await createTrack("Visible");
    trackIds.push(track.id);
    await prisma.userTrack.create({ data: { userId, trackId: track.id } });

    const body = readData(
      await loader(pageRequest(cookie, "http://localhost/library?genre=%20") as never),
    );

    expect(body.genreId).toBeNull();
    expect(body.genre).toBeNull();
    expect(body.userTracks.map((row) => row.track.title)).toEqual(["Visible"]);
  });
});
