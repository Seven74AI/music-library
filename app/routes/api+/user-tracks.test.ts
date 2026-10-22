import { parseString } from "set-cookie-parser";
import { afterEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./user-tracks.tsx";

type UserTracksBody = {
  userTracks: Array<{ track: { title: string } }>;
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

function apiRequest(cookie: string, url: string) {
  const request = new Request(url, { headers: { cookie } });
  return { request, url: new URL(request.url), params: {}, context: {} };
}

describe("GET /api/user-tracks genre filter", () => {
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

  test("returns only library tracks tagged with the genre", async () => {
    const { userId, cookie } = await createUserCookie();
    userIds.push(userId);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tagged = await createTrack("API Tagged");
    const other = await createTrack("API Other");
    const playable = await createTrack("API Playable");
    trackIds.push(tagged.id, other.id, playable.id);
    const genre = await prisma.genre.create({
      data: {
        name: `API Jazz ${suffix}`,
        normalizedName: `api jazz ${suffix}`,
        tracks: { connect: [{ id: tagged.id }, { id: playable.id }] },
      },
    });
    genreIds.push(genre.id);
    await prisma.userTrack.createMany({
      data: [tagged.id, other.id, playable.id].map((trackId) => ({ userId, trackId })),
    });
    await prisma.trackAudioFile.create({
      data: { trackId: playable.id, objectKey: `audio/${playable.id}.mp3`, format: "mp3" },
    });

    const filtered = (await (
      await loader(
        apiRequest(cookie, `http://localhost/api/user-tracks?genre=${genre.id}`) as never,
      )
    ).json()) as UserTracksBody;
    expect(filtered.userTracks.map((row) => row.track.title).sort()).toEqual([
      "API Playable",
      "API Tagged",
    ]);

    const withAudio = (await (
      await loader(
        apiRequest(
          cookie,
          `http://localhost/api/user-tracks?genre=${genre.id}&hasAudio=1`,
        ) as never,
      )
    ).json()) as UserTracksBody;
    expect(withAudio.userTracks.map((row) => row.track.title)).toEqual(["API Playable"]);

    const unknown = (await (
      await loader(
        apiRequest(cookie, "http://localhost/api/user-tracks?genre=missing-genre") as never,
      )
    ).json()) as UserTracksBody;
    expect(unknown.userTracks).toEqual([]);

    const unfiltered = (await (
      await loader(apiRequest(cookie, "http://localhost/api/user-tracks") as never)
    ).json()) as UserTracksBody;
    expect(unfiltered.userTracks).toHaveLength(3);
  });
});
