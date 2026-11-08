import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { addTrackToUserPlaylist } from "#app/utils/user-playlist.server.ts";
import { normalizeArtistName } from "#app/utils/artist-management.server.ts";
import { LOCAL_SERVICE } from "#app/constants/services.ts";

describe("UserPlaylist title uniqueness (DB-level guard)", () => {
  beforeEach(async () => {
    await prisma.userPlaylistTrack.deleteMany();
    await prisma.userPlaylist.deleteMany();
  });

  test("rejects a case-insensitive duplicate title for the same owner", async () => {
    const user = await prisma.user.create({ data: createUser() });
    await prisma.userPlaylist.create({ data: { title: "Road Trip", ownerId: user.id } });

    await expect(
      prisma.userPlaylist.create({ data: { title: "road trip", ownerId: user.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  test("swaps playlist positions 0 and 1 without a unique constraint failure", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const playlist = await prisma.userPlaylist.create({
      data: { title: "Reorder", ownerId: user.id },
    });
    const service = await prisma.service.upsert({
      where: { name: LOCAL_SERVICE.NAME },
      update: {},
      create: {
        name: LOCAL_SERVICE.NAME,
        displayName: LOCAL_SERVICE.DISPLAY_NAME,
        baseUrl: LOCAL_SERVICE.BASE_URL,
      },
    });
    const artistName = `Artist ${Date.now()}`;
    const artist = await prisma.artist.create({
      data: { name: artistName, normalizedName: normalizeArtistName(artistName) },
    });
    const tracks = await Promise.all(
      [0, 1].map((index) =>
        prisma.track.create({
          data: {
            title: `Track ${index}`,
            artistId: artist.id,
            serviceId: service.id,
            externalId: `ext-${Date.now()}-${index}`,
          },
        }),
      ),
    );

    const rows = await Promise.all(
      tracks.map((track, position) =>
        prisma.userPlaylistTrack.create({
          data: { playlistId: playlist.id, trackId: track.id, position },
          select: { id: true, position: true, trackId: true },
        }),
      ),
    );

    await prisma.$transaction(
      rows.map((row) =>
        prisma.userPlaylistTrack.update({
          where: { id: row.id },
          data: { position: row.position === 0 ? 1 : 0 },
        }),
      ),
    );

    expect(
      await prisma.userPlaylistTrack.findMany({
        where: { playlistId: playlist.id },
        orderBy: { position: "asc" },
        select: { trackId: true, position: true },
      }),
    ).toEqual([
      { trackId: tracks[1]!.id, position: 0 },
      { trackId: tracks[0]!.id, position: 1 },
    ]);
  });

  test("sequential appends assign the next position without error", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const playlist = await prisma.userPlaylist.create({
      data: { title: "Append", ownerId: user.id },
    });
    const service = await prisma.service.upsert({
      where: { name: LOCAL_SERVICE.NAME },
      update: {},
      create: {
        name: LOCAL_SERVICE.NAME,
        displayName: LOCAL_SERVICE.DISPLAY_NAME,
        baseUrl: LOCAL_SERVICE.BASE_URL,
      },
    });
    const artistName = `Artist ${Date.now()}`;
    const artist = await prisma.artist.create({
      data: { name: artistName, normalizedName: normalizeArtistName(artistName) },
    });
    const tracks = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.track.create({
          data: {
            title: `Track ${index}`,
            artistId: artist.id,
            serviceId: service.id,
            externalId: `ext-append-${Date.now()}-${index}`,
          },
        }),
      ),
    );

    for (const track of tracks) {
      const result = await addTrackToUserPlaylist({
        userId: user.id,
        playlistId: playlist.id,
        trackId: track.id,
      });
      expect(result).toMatchObject({ status: "success" });
    }

    expect(
      await prisma.userPlaylistTrack.findMany({
        where: { playlistId: playlist.id },
        orderBy: { position: "asc" },
        select: { trackId: true, position: true },
      }),
    ).toEqual(tracks.map((track, position) => ({ trackId: track.id, position })));
  });

  test("allows the same title for different owners", async () => {
    const alice = await prisma.user.create({ data: createUser() });
    const bob = await prisma.user.create({ data: createUser() });
    await prisma.userPlaylist.create({ data: { title: "Road Trip", ownerId: alice.id } });

    await expect(
      prisma.userPlaylist.create({ data: { title: "Road Trip", ownerId: bob.id } }),
    ).resolves.toMatchObject({ title: "Road Trip", ownerId: bob.id });
  });
});
