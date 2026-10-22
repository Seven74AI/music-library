import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { getOrCreateArtist, getOrCreateArtistTx } from "./artist-management.server.ts";

describe("getOrCreateArtist merge following", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.artist.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  });

  test("returns the canonical target when the matched artist was merged", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const target = await prisma.artist.create({
      data: {
        name: `Beatles ${stamp}`,
        normalizedName: `beatles ${stamp}`,
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `The Beatles ${stamp}`,
        normalizedName: `the beatles ${stamp}`,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const result = await getOrCreateArtist(`The Beatles ${stamp}`);

    expect(result.id).toBe(target.id);
    expect(result.name).toBe(target.name);
  });

  test("follows a merge chain to the final living artist", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const canonical = await prisma.artist.create({
      data: {
        name: `Canonical ${stamp}`,
        normalizedName: `canonical ${stamp}`,
      },
    });
    const mid = await prisma.artist.create({
      data: {
        name: `Mid ${stamp}`,
        normalizedName: `mid ${stamp}`,
        mergedIntoId: canonical.id,
        mergedAt: new Date(),
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Source ${stamp}`,
        normalizedName: `source ${stamp}`,
        mergedIntoId: mid.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, mid.id, canonical.id);

    const result = await getOrCreateArtist(`Source ${stamp}`);

    expect(result.id).toBe(canonical.id);
  });

  test("still returns the oldest unmerged artist when nothing was merged", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const older = await prisma.artist.create({
      data: {
        name: `Same Name ${stamp}`,
        normalizedName: `same name ${stamp}`,
      },
    });
    const newer = await prisma.artist.create({
      data: {
        name: `Same Name ${stamp}`,
        normalizedName: `same name ${stamp}`,
      },
    });
    createdIds.push(older.id, newer.id);

    const result = await getOrCreateArtist(`Same Name ${stamp}`);

    expect(result.id).toBe(older.id);
  });

  test("getOrCreateArtistTx follows mergedIntoId inside a transaction", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const target = await prisma.artist.create({
      data: {
        name: `Tx Target ${stamp}`,
        normalizedName: `tx target ${stamp}`,
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Tx Source ${stamp}`,
        normalizedName: `tx source ${stamp}`,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const result = await prisma.$transaction((tx) => getOrCreateArtistTx(tx, `Tx Source ${stamp}`));

    expect(result.id).toBe(target.id);
  });
});
