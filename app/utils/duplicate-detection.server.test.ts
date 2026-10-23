import { randomBytes } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  cacheAlbumNormalizedNames,
  cacheArtistNormalizedNames,
  findExactAlbumDuplicates,
  findExactArtistDuplicates,
  findFuzzyAlbumDuplicates,
  readAlbumDuplicateGroupsFromCache,
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

test("findFuzzyAlbumDuplicates detects cross-artist duplicates with similar names and year within ±2", async () => {
  const token = randomBytes(4).toString("hex");

  // Similar artist names ("pink x" vs "pynk x" -> distance 1)
  const artist1 = await prisma.artist.create({
    data: { name: `The Pink ${token}`, normalizedName: `pink ${token}` },
  });
  const artist2 = await prisma.artist.create({
    data: { name: `Pynk ${token}`, normalizedName: `pynk ${token}` },
  });
  artistIds.push(artist1.id, artist2.id);

  // Similar album names ("dark side x" vs "dark sied x" -> distance 2), year diff 1
  const album1 = await prisma.album.create({
    data: { name: `Dark Side ${token}`, artistId: artist1.id, year: 1973 },
  });
  const album2 = await prisma.album.create({
    data: { name: `Dark Sied ${token}`, artistId: artist2.id, year: 1974 },
  });

  const groups = await findFuzzyAlbumDuplicates();

  const group = groups.find(
    (g) => g.albums.some((a) => a.id === album1.id) && g.albums.some((a) => a.id === album2.id),
  );

  expect(group).toBeDefined();
  expect(group?.matchType).toBe("fuzzy");
  // Cross-artist groups span multiple artists, so no single artist
  expect(group?.artistId).toBeNull();
  expect(group?.artistName).toBeNull();
  // Each album entry carries its own artist
  expect(group?.albums.find((a) => a.id === album1.id)?.artistName).toBe(`The Pink ${token}`);
  expect(group?.albums.find((a) => a.id === album2.id)?.artistName).toBe(`Pynk ${token}`);
});

test("findFuzzyAlbumDuplicates ignores cross-artist pairs with year outside ±2", async () => {
  const token = randomBytes(4).toString("hex");

  const artist1 = await prisma.artist.create({
    data: { name: `The Pink ${token}`, normalizedName: `pink ${token}` },
  });
  const artist2 = await prisma.artist.create({
    data: { name: `Pynk ${token}`, normalizedName: `pynk ${token}` },
  });
  artistIds.push(artist1.id, artist2.id);

  const album1 = await prisma.album.create({
    data: { name: `Dark Side ${token}`, artistId: artist1.id, year: 1973 },
  });
  const album2 = await prisma.album.create({
    data: { name: `Dark Sied ${token}`, artistId: artist2.id, year: 1985 },
  });

  const groups = await findFuzzyAlbumDuplicates();

  const group = groups.find(
    (g) => g.albums.some((a) => a.id === album1.id) && g.albums.some((a) => a.id === album2.id),
  );

  expect(group).toBeUndefined();
});

test("findFuzzyAlbumDuplicates ignores cross-artist pairs with dissimilar artist names", async () => {
  const token = randomBytes(4).toString("hex");

  const artist1 = await prisma.artist.create({
    data: { name: `The Beatles ${token}`, normalizedName: `beatles ${token}` },
  });
  const artist2 = await prisma.artist.create({
    data: { name: `Led Zeppelin ${token}`, normalizedName: `led zeppelin ${token}` },
  });
  artistIds.push(artist1.id, artist2.id);

  const album1 = await prisma.album.create({
    data: { name: `Abbey Road ${token}`, artistId: artist1.id, year: 1970 },
  });
  const album2 = await prisma.album.create({
    data: { name: `Abby Road ${token}`, artistId: artist2.id, year: 1971 },
  });

  const groups = await findFuzzyAlbumDuplicates();

  const group = groups.find(
    (g) => g.albums.some((a) => a.id === album1.id) && g.albums.some((a) => a.id === album2.id),
  );

  expect(group).toBeUndefined();
});

test("findFuzzyAlbumDuplicates still detects same-artist fuzzy duplicates", async () => {
  const token = randomBytes(4).toString("hex");

  const artist = await prisma.artist.create({
    data: { name: `Queen ${token}`, normalizedName: `queen ${token}` },
  });
  artistIds.push(artist.id);

  const album1 = await prisma.album.create({
    data: { name: `Night Opera ${token}`, artistId: artist.id, year: 1975 },
  });
  const album2 = await prisma.album.create({
    data: { name: `Night Oprea ${token}`, artistId: artist.id, year: 1975 },
  });

  const groups = await findFuzzyAlbumDuplicates();

  const group = groups.find(
    (g) => g.albums.some((a) => a.id === album1.id) && g.albums.some((a) => a.id === album2.id),
  );

  expect(group).toBeDefined();
  expect(group?.matchType).toBe("fuzzy");
  expect(group?.artistId).toBe(artist.id);
  expect(group?.artistName).toBe(`Queen ${token}`);
});

test("readAlbumDuplicateGroupsFromCache reconstructs cross-artist fuzzy groups", async () => {
  const token = randomBytes(4).toString("hex");

  const artist1 = await prisma.artist.create({
    data: { name: `The Pink ${token}`, normalizedName: `pink ${token}` },
  });
  const artist2 = await prisma.artist.create({
    data: { name: `Pynk ${token}`, normalizedName: `pynk ${token}` },
  });
  artistIds.push(artist1.id, artist2.id);

  const album1 = await prisma.album.create({
    data: { name: `Dark Side ${token}`, artistId: artist1.id, year: 1973 },
  });
  const album2 = await prisma.album.create({
    data: { name: `Dark Sied ${token}`, artistId: artist2.id, year: 1974 },
  });

  // Detect, persist pairs to the cache, then read groups back from it.
  const fuzzy = await findFuzzyAlbumDuplicates();
  await saveDuplicateDetectionResults("album", [], fuzzy);

  const { fuzzy: cachedFuzzy } = await readAlbumDuplicateGroupsFromCache();

  const group = cachedFuzzy.find(
    (g) => g.albums.some((a) => a.id === album1.id) && g.albums.some((a) => a.id === album2.id),
  );

  expect(group).toBeDefined();
  expect(group?.matchType).toBe("fuzzy");
  expect(group?.artistId).toBeNull();
  expect(group?.artistName).toBeNull();
  expect(group?.albums.find((a) => a.id === album1.id)?.artistName).toBe(`The Pink ${token}`);
  expect(group?.albums.find((a) => a.id === album2.id)?.artistName).toBe(`Pynk ${token}`);
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
