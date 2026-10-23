import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  getOrCreateArtist,
  getOrCreateArtistTx,
  normalizeArtistName,
} from "./artist-management.server.ts";

// Alphanumeric stamp (no hyphen) so the ADR-034 canonical normalization
// (which strips punctuation) does not alter it between write and lookup.
function stamp(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

describe("getOrCreateArtist merge following", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.artist.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  });

  test("returns the canonical target when the matched artist was merged", async () => {
    const s = stamp();
    const target = await prisma.artist.create({
      data: {
        name: `Beatles ${s}`,
        normalizedName: normalizeArtistName(`Beatles ${s}`),
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Legacy Beatles ${s}`,
        normalizedName: normalizeArtistName(`Legacy Beatles ${s}`),
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const result = await getOrCreateArtist(`Legacy Beatles ${s}`);

    expect(result.id).toBe(target.id);
    expect(result.name).toBe(target.name);
  });

  test("follows a merge chain to the final living artist", async () => {
    const s = stamp();
    const canonical = await prisma.artist.create({
      data: {
        name: `Canonical ${s}`,
        normalizedName: normalizeArtistName(`Canonical ${s}`),
      },
    });
    const mid = await prisma.artist.create({
      data: {
        name: `Mid ${s}`,
        normalizedName: normalizeArtistName(`Mid ${s}`),
        mergedIntoId: canonical.id,
        mergedAt: new Date(),
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Source ${s}`,
        normalizedName: normalizeArtistName(`Source ${s}`),
        mergedIntoId: mid.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, mid.id, canonical.id);

    const result = await getOrCreateArtist(`Source ${s}`);

    expect(result.id).toBe(canonical.id);
  });

  test("still returns the oldest unmerged artist when nothing was merged", async () => {
    const s = stamp();
    const older = await prisma.artist.create({
      data: {
        name: `Same Name ${s}`,
        normalizedName: normalizeArtistName(`Same Name ${s}`),
      },
    });
    const newer = await prisma.artist.create({
      data: {
        name: `Same Name ${s}`,
        normalizedName: normalizeArtistName(`Same Name ${s}`),
      },
    });
    createdIds.push(older.id, newer.id);

    const result = await getOrCreateArtist(`Same Name ${s}`);

    expect(result.id).toBe(older.id);
  });

  test("getOrCreateArtistTx follows mergedIntoId inside a transaction", async () => {
    const s = stamp();
    const target = await prisma.artist.create({
      data: {
        name: `Tx Target ${s}`,
        normalizedName: normalizeArtistName(`Tx Target ${s}`),
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Tx Source ${s}`,
        normalizedName: normalizeArtistName(`Tx Source ${s}`),
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const result = await prisma.$transaction((tx) => getOrCreateArtistTx(tx, `Tx Source ${s}`));

    expect(result.id).toBe(target.id);
  });
});

describe("normalizeArtistName (ADR-034 single source of truth)", () => {
  test("drops leading 'the', normalizes unicode, and strips punctuation", () => {
    expect(normalizeArtistName("The Beatles")).toBe("beatles");
    expect(normalizeArtistName("Björk")).toBe("bjork");
    expect(normalizeArtistName("AC/DC")).toBe("acdc");
  });

  test("getOrCreateArtist stores the ADR-034 normalized name", async () => {
    const s = stamp();
    const result = await getOrCreateArtist(`The Beatles ${s}`);

    const artistInDb = await prisma.artist.findUnique({ where: { id: result.id } });
    expect(artistInDb?.normalizedName).toBe(normalizeArtistName(`The Beatles ${s}`));

    await prisma.artist.delete({ where: { id: result.id } }).catch(() => {});
  });
});
