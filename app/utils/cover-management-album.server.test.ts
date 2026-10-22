import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { getOrCreateAlbum, getOrCreateAlbumTx } from "./cover-management.server.ts";

describe("getOrCreateAlbum merge following", () => {
  const artistIds: string[] = [];
  const albumIds: string[] = [];

  afterEach(async () => {
    if (albumIds.length) {
      await prisma.album.deleteMany({ where: { id: { in: albumIds } } });
      albumIds.length = 0;
    }
    if (artistIds.length) {
      await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
      artistIds.length = 0;
    }
  });

  test("returns the canonical target when the matched album was merged", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: {
        name: `Album Artist ${stamp}`,
        normalizedName: `album artist ${stamp}`,
      },
    });
    artistIds.push(artist.id);

    const target = await prisma.album.create({
      data: {
        name: `Abbey Road ${stamp}`,
        artistId: artist.id,
      },
    });
    const source = await prisma.album.create({
      data: {
        name: `Abbey Road (Remaster) ${stamp}`,
        artistId: artist.id,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    albumIds.push(source.id, target.id);

    const result = await getOrCreateAlbum(artist.id, `Abbey Road (Remaster) ${stamp}`);

    expect(result?.id).toBe(target.id);
  });

  test("getOrCreateAlbumTx follows mergedIntoId inside a transaction", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: {
        name: `Tx Album Artist ${stamp}`,
        normalizedName: `tx album artist ${stamp}`,
      },
    });
    artistIds.push(artist.id);

    const target = await prisma.album.create({
      data: {
        name: `Target Album ${stamp}`,
        artistId: artist.id,
      },
    });
    const source = await prisma.album.create({
      data: {
        name: `Source Album ${stamp}`,
        artistId: artist.id,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    albumIds.push(source.id, target.id);

    const result = await prisma.$transaction((tx) =>
      getOrCreateAlbumTx(tx, artist.id, `Source Album ${stamp}`),
    );

    expect(result?.id).toBe(target.id);
  });
});
