import { randomBytes } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  cacheAlbumNormalizedNames,
  cacheArtistNormalizedNames,
  findExactAlbumDuplicates,
  findExactArtistDuplicates,
  saveDuplicateDetectionResults,
} from "./duplicate-detection.server.ts";

const artistIds: string[] = [];

afterEach(async () => {
  if (artistIds.length === 0) return;
  await prisma.album.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.updateMany({
    where: { id: { in: artistIds } },
    data: { mergedIntoId: null },
  });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  artistIds.length = 0;
});

test("exact duplicate detection ignores artists and albums that were already merged", async () => {
  const token = randomBytes(4).toString("hex");
  const kept = await prisma.artist.create({
    data: { name: `Mergecheck ${token}`, normalizedName: `mergecheck ${token}` },
  });
  const merged = await prisma.artist.create({
    data: {
      name: `The Mergecheck ${token}`,
      normalizedName: `mergecheck ${token}`,
      mergedIntoId: kept.id,
    },
  });
  const host = await prisma.artist.create({
    data: { name: `Album Host ${token}`, normalizedName: `album host ${token}` },
  });
  artistIds.push(kept.id, merged.id, host.id);

  const keptAlbum = await prisma.album.create({
    data: { name: `Merge Album ${token}`, artistId: host.id },
  });
  await prisma.album.create({
    data: {
      name: `Merge Album ${token}!`,
      artistId: host.id,
      mergedIntoId: keptAlbum.id,
    },
  });

  const artists = await findExactArtistDuplicates();
  const albums = await findExactAlbumDuplicates();

  expect(artists.some((group) => group.normalizedName === `mergecheck ${token}`)).toBe(false);
  expect(albums.some((group) => group.normalizedName === `merge album ${token}`)).toBe(false);
});

test("cacheArtistNormalizedNames and cacheAlbumNormalizedNames bulk-write the cache", async () => {
  const token = randomBytes(4).toString("hex");
  const artist = await prisma.artist.create({
    data: { name: `Cache Artist ${token}`, normalizedName: `cache artist ${token}` },
  });
  const album = await prisma.album.create({
    data: { name: `Cache Album ${token}`, artistId: artist.id },
  });
  artistIds.push(artist.id);

  await cacheArtistNormalizedNames();
  await cacheAlbumNormalizedNames();

  const artistCache = await prisma.normalizedName.findUnique({
    where: { entityType_entityId: { entityType: "artist", entityId: artist.id } },
  });
  const albumCache = await prisma.normalizedName.findUnique({
    where: { entityType_entityId: { entityType: "album", entityId: album.id } },
  });

  expect(artistCache?.originalName).toBe(artist.name);
  expect(artistCache?.normalizedName).toBe(`cache artist ${token}`);
  expect(albumCache?.originalName).toBe(album.name);
  expect(albumCache?.normalizedName).toBe(`cache album ${token}`);
});

test("saveDuplicateDetectionResults bulk-inserts exact and fuzzy pairs", async () => {
  const token = randomBytes(4).toString("hex");
  const name = `Dup Artist ${token}`;
  const a1 = await prisma.artist.create({
    data: { name, normalizedName: name.toLowerCase() },
  });
  const a2 = await prisma.artist.create({
    data: { name, normalizedName: name.toLowerCase() },
  });
  artistIds.push(a1.id, a2.id);

  await saveDuplicateDetectionResults(
    "artist",
    [
      {
        normalizedName: name.toLowerCase(),
        matchType: "exact",
        artists: [
          { id: a1.id, name, trackCount: 0, albumCount: 0 },
          { id: a2.id, name, trackCount: 0, albumCount: 0 },
        ],
        totalTracks: 0,
        totalAlbums: 0,
      },
    ],
    [],
  );

  const rows = await prisma.duplicateDetection.findMany({
    where: { entityType: "artist", entityId1: a1.id, entityId2: a2.id },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.matchType).toBe("exact");
  expect(rows[0]?.similarity).toBe(0);
});
