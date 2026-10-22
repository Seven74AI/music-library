import { randomBytes } from "node:crypto";
import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { generateRoomCode } from "./codes.ts";
import {
  createGuestToken,
  hashGuestToken,
  serializeGuestTokenCookie,
} from "./guest-token.server.ts";
import { loadRoomAlbum, loadRoomArtist } from "./room-catalog.server.ts";
import { loader as albumLoader } from "#app/routes/rooms.$code.search.albums.$albumId.tsx";
import { loader as artistLoader } from "#app/routes/rooms.$code.search.artists.$artistId.tsx";
import { createUser } from "#tests/db-utils.ts";

const artistIds: string[] = [];
const coverIds: string[] = [];
const roomIds: string[] = [];

async function cleanup() {
  if (artistIds.length > 0) {
    await prisma.artist.deleteMany({ where: { id: { in: artistIds.splice(0) } } });
  }
  if (coverIds.length > 0) {
    await prisma.coverImage.deleteMany({ where: { id: { in: coverIds.splice(0) } } });
  }
  if (roomIds.length > 0) {
    await prisma.roomPlayEvent.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.roomQueueItem.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.roomParticipant.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.room.deleteMany({ where: { id: { in: roomIds.splice(0) } } });
  }
}

async function serviceId() {
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return service.id;
}

async function seatGuest(roomId: string) {
  const rawToken = createGuestToken();
  await prisma.roomParticipant.create({
    data: {
      roomId,
      displayName: "Walkup",
      role: "listener",
      guestTokenHash: hashGuestToken(rawToken),
    },
  });
  const setCookie = await serializeGuestTokenCookie(rawToken);
  const parsed = parseString(setCookie);
  if (!parsed) throw new Error("expected guest cookie");
  return `${parsed.name}=${parsed.value}`;
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

test("album page keeps playable tracks in track-number order", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const local = await serviceId();
  const artist = await prisma.artist.create({
    data: { name: `Ada ${suffix}`, normalizedName: `ada ${suffix}` },
  });
  artistIds.push(artist.id);
  const cover = await prisma.coverImage.create({
    data: { contentHash: `hash-${suffix}`, objectKey: `covers/${suffix}.jpg` },
  });
  coverIds.push(cover.id);
  const album = await prisma.album.create({
    data: {
      name: `Blue ${suffix}`,
      year: 1974,
      artistId: artist.id,
      coverImageId: cover.id,
    },
  });
  const second = await prisma.track.create({
    data: {
      title: "Second",
      trackNumber: 2,
      externalId: `ext-2-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: album.id,
      audioFiles: { create: { objectKey: `audio/2-${suffix}.flac`, format: "flac" } },
    },
  });
  await prisma.track.create({
    data: {
      title: "Silent",
      trackNumber: 3,
      externalId: `ext-3-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: album.id,
    },
  });
  const first = await prisma.track.create({
    data: {
      title: "First",
      trackNumber: 1,
      externalId: `ext-1-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: album.id,
      audioFiles: { create: { objectKey: `audio/1-${suffix}.flac`, format: "flac" } },
    },
  });
  const unnumbered = await prisma.track.create({
    data: {
      title: "Unnumbered",
      externalId: `ext-u-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: album.id,
      audioFiles: { create: { objectKey: `audio/u-${suffix}.flac`, format: "flac" } },
    },
  });

  const page = await loadRoomAlbum(album.id);

  expect(page).toMatchObject({
    id: album.id,
    name: album.name,
    year: 1974,
    coverObjectKey: cover.objectKey,
    artist: { id: artist.id, name: artist.name },
  });
  expect(page?.tracks.map((track) => track.id)).toEqual([first.id, second.id, unnumbered.id]);
  expect(page?.tracks.map((track) => track.title)).toEqual(["First", "Second", "Unnumbered"]);
  expect(await loadRoomAlbum("missing-album")).toBeNull();
});

test("artist page lists playable albums and tracks only", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const local = await serviceId();
  const artist = await prisma.artist.create({
    data: {
      name: `Ada ${suffix}`,
      normalizedName: `ada ${suffix}`,
      genre: "Jazz",
      imageUrl: `artists/${suffix}.jpg`,
    },
  });
  artistIds.push(artist.id);
  const later = await prisma.album.create({
    data: { name: "Later", year: 2001, artistId: artist.id },
  });
  const earlier = await prisma.album.create({
    data: { name: "Earlier", year: 1990, artistId: artist.id },
  });
  const silentAlbum = await prisma.album.create({
    data: { name: "Silent Album", year: 1980, artistId: artist.id },
  });
  await prisma.track.create({
    data: {
      title: "Later Hit",
      externalId: `ext-later-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: later.id,
      audioFiles: { create: { objectKey: `audio/later-${suffix}.flac`, format: "flac" } },
    },
  });
  await prisma.track.create({
    data: {
      title: "Early Hit",
      externalId: `ext-early-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: earlier.id,
      audioFiles: { create: { objectKey: `audio/early-${suffix}.flac`, format: "flac" } },
    },
  });
  await prisma.track.create({
    data: {
      title: "No Audio",
      externalId: `ext-silent-${suffix}`,
      serviceId: local,
      artistId: artist.id,
      albumId: silentAlbum.id,
    },
  });

  const page = await loadRoomArtist(artist.id);

  expect(page?.genre).toBe("Jazz");
  expect(page?.imageObjectKey).toBe(`artists/${suffix}.jpg`);
  expect(page?.albums.map((album) => album.name)).toEqual(["Earlier", "Later"]);
  expect(page?.albums.map((album) => album.trackCount)).toEqual([1, 1]);
  expect(page?.trackCount).toBe(2);
  expect(page?.tracks.map((track) => track.title).sort()).toEqual(["Early Hit", "Later Hit"]);
  expect(await loadRoomArtist("missing-artist")).toBeNull();
});

test("album and artist loaders redirect until the guest has a seat", async () => {
  const host = await prisma.user.create({
    data: { ...createUser(), roles: { connect: { name: "user" } } },
  });
  const code = generateRoomCode(6, () => randomBytes(1)[0]! / 256);
  const room = await prisma.room.create({
    data: { code, status: "open", originalHostUserId: host.id },
  });
  roomIds.push(room.id);

  await expectRedirect(albumLoader, code, { albumId: "missing" });
  await expectRedirect(artistLoader, code, { artistId: "missing" });

  const cookie = await seatGuest(room.id);
  try {
    await albumLoader({
      request: new Request(`http://localhost/rooms/${code}/search/albums/missing`, {
        headers: { cookie },
      }),
      params: { code, albumId: "missing" },
    });
    expect.fail("expected a not found response");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(404);
  }
});

async function expectRedirect(
  loader: (args: {
    request: Request;
    params: { code?: string; albumId?: string; artistId?: string };
  }) => Promise<unknown>,
  code: string,
  params: { albumId?: string; artistId?: string },
) {
  try {
    await loader({
      request: new Request(`http://localhost/rooms/${code}/search`),
      params: { code, ...params },
    });
    expect.fail("expected a redirect into the room");
  } catch (error) {
    expect(error).toHaveRedirect(`/rooms/${code}`);
  }
}
