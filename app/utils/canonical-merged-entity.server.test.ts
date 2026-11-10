import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  followMergedIntoIdChain,
  MergedEntityResolutionError,
  resolveCanonicalIdFromStartId,
} from "./canonical-merged-entity.server.ts";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

describe("canonical merged-entity resolver", () => {
  const createdArtistIds: string[] = [];
  const createdAlbumIds: string[] = [];

  afterEach(async () => {
    if (createdAlbumIds.length > 0) {
      await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
      createdAlbumIds.length = 0;
    }
    if (createdArtistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
      createdArtistIds.length = 0;
    }
  });

  test("resolves a merged entity to the canonical target", async () => {
    const mark = stamp();
    const target = await prisma.album.create({
      data: {
        name: `Canonical ${mark}`,
        artistId: (
          await prisma.artist.create({
            data: { name: `A ${mark}`, normalizedName: `a ${mark}` },
          })
        ).id,
      },
    });
    const artistId = (await prisma.album.findUniqueOrThrow({ where: { id: target.id } })).artistId;
    createdArtistIds.push(artistId);
    const source = await prisma.album.create({
      data: {
        name: `Alias ${mark}`,
        artistId,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdAlbumIds.push(source.id, target.id);

    const canonicalId = await resolveCanonicalIdFromStartId(source.id, (id) =>
      prisma.album.findUnique({
        where: { id },
        select: { id: true, mergedIntoId: true },
      }),
    );

    expect(canonicalId).toBe(target.id);
  });

  test("returns a domain error for a broken merge chain without leaking ids", async () => {
    const mark = stamp();
    const artist = await prisma.artist.create({
      data: { name: `Artist ${mark}`, normalizedName: `artist ${mark}` },
    });
    createdArtistIds.push(artist.id);
    const source = await prisma.album.create({
      data: { name: `Dangling ${mark}`, artistId: artist.id },
    });
    createdAlbumIds.push(source.id);

    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Album" SET "mergedIntoId" = ? WHERE id = ?`,
        "missing-merge-target",
        source.id,
      );
    } finally {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    }

    await expect(
      resolveCanonicalIdFromStartId(source.id, (id) =>
        prisma.album.findUnique({
          where: { id },
          select: { id: true, mergedIntoId: true },
        }),
      ),
    ).rejects.toBeInstanceOf(MergedEntityResolutionError);

    try {
      await resolveCanonicalIdFromStartId(source.id, (id) =>
        prisma.album.findUnique({
          where: { id },
          select: { id: true, mergedIntoId: true },
        }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(MergedEntityResolutionError);
      expect((error as Error).message).not.toMatch(/missing-merge-target/);
      expect((error as Error).message).not.toContain(source.id);
    }
  });

  test("followMergedIntoIdChain rejects cycles with the domain error", async () => {
    const mark = stamp();
    const artist = await prisma.artist.create({
      data: { name: `Cycle ${mark}`, normalizedName: `cycle ${mark}` },
    });
    createdArtistIds.push(artist.id);
    const left = await prisma.album.create({
      data: { name: `Left ${mark}`, artistId: artist.id },
    });
    const right = await prisma.album.create({
      data: { name: `Right ${mark}`, artistId: artist.id },
    });
    createdAlbumIds.push(left.id, right.id);
    await prisma.album.update({ where: { id: left.id }, data: { mergedIntoId: right.id } });
    await prisma.album.update({ where: { id: right.id }, data: { mergedIntoId: left.id } });

    const start = await prisma.album.findUniqueOrThrow({
      where: { id: left.id },
      select: { id: true, mergedIntoId: true },
    });

    await expect(
      followMergedIntoIdChain(start, (mergedIntoId) =>
        prisma.album.findUnique({
          where: { id: mergedIntoId },
          select: { id: true, mergedIntoId: true },
        }),
      ),
    ).rejects.toBeInstanceOf(MergedEntityResolutionError);
  });
});
