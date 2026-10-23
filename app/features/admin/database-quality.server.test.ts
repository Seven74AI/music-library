/**
 * Suspicious duration thresholds are in seconds. Track.duration is stored in
 * seconds (formatDuration treats 185 as about 3:05).
 */
import { afterEach, expect, test } from "vitest";
import { compressChromaprint } from "#tests/chromaprint-test-utils";
import { prisma } from "#app/utils/db.server.ts";
import { cache } from "#app/utils/cache.server.ts";
import { loadDuplicateDashboard } from "./duplicate-dashboard.server.ts";
import { percentOfTracksAffected } from "./database-quality.ts";
import {
  DATABASE_QUALITY_CACHE_KEY,
  countTracksWithMetadataIssues,
  getDatabaseQualitySnapshot,
  getDuplicateTracksCount,
  getMetadataIssues,
  getStorageStats,
} from "./database-quality.server.ts";
import { getAdminOverviewHealth } from "./overview-health.server.ts";

const createdTrackIds: string[] = [];
const createdArtistIds: string[] = [];
const createdServiceIds: string[] = [];

afterEach(async () => {
  if (createdTrackIds.length > 0) {
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdArtistIds.length > 0) {
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
  if (createdServiceIds.length > 0) {
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    createdServiceIds.length = 0;
  }
});

test("getMetadataIssues counts durations under 5 seconds or over 2 hours, not millisecond cutoffs", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: {
      name: `Duration Artist ${suffix}`,
      normalizedName: `duration-artist-${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const service = await prisma.service.create({
    data: {
      name: `duration-service-${suffix}`,
      displayName: `Duration Service ${suffix}`,
      baseUrl: "https://example.com",
    },
  });
  createdServiceIds.push(service.id);

  // 185s is a normal song (~3:05). 4999s is 1h 23m, which the millisecond
  // cutoff (duration < 5000) incorrectly treats as suspicious.
  const fixtures = [
    { title: "Lovestory", duration: 185, suspicious: false },
    { title: "Inanimee", duration: 168, suspicious: false },
    { title: "Exactly five seconds", duration: 5, suspicious: false },
    { title: "Exactly two hours", duration: 7200, suspicious: false },
    { title: "Under mistaken millisecond cutoff", duration: 4999, suspicious: false },
    { title: "Three seconds", duration: 3, suspicious: true },
    { title: "Just over two hours", duration: 7201, suspicious: true },
  ];

  const before = await getMetadataIssues();

  const tracks = await Promise.all(
    fixtures.map((fixture, index) =>
      prisma.track.create({
        data: {
          title: `${fixture.title} ${suffix}`,
          artistId: artist.id,
          serviceId: service.id,
          externalId: `duration-${suffix}-${index}`,
          duration: fixture.duration,
        },
      }),
    ),
  );
  createdTrackIds.push(...tracks.map((track) => track.id));

  const after = await getMetadataIssues();
  const expectedAdded = fixtures.filter((fixture) => fixture.suspicious).length;

  expect(
    after.suspiciousDurations - before.suspiciousDurations,
    "only tracks shorter than 5 seconds or longer than 7200 seconds should be added",
  ).toBe(expectedAdded);
});

test("affected track count is a distinct union and excludes artists without genre", async () => {
  const affectedBefore = await countTracksWithMetadataIssues();
  const issuesBefore = await getMetadataIssues();
  const totalTracksBefore = await prisma.track.count();

  const uniqueId = `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.create({
    data: {
      name: `meta-service-${uniqueId}`,
      displayName: `Meta Service ${uniqueId}`,
      baseUrl: "https://example.com",
    },
  });
  const artist = await prisma.artist.create({
    data: {
      name: `No Genre ${uniqueId}`,
      normalizedName: `no-genre-${uniqueId}`,
      genre: null,
    },
  });
  const cover = await prisma.coverImage.create({
    data: {
      contentHash: `cover-${uniqueId}`,
      objectKey: `covers/${uniqueId}.jpg`,
      format: "jpeg",
    },
  });

  await prisma.track.create({
    data: {
      title: `Clean ${uniqueId}`,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `clean-${uniqueId}`,
      duration: 180,
      year: 2020,
      coverImageId: cover.id,
    },
  });

  const affectedAfterClean = await countTracksWithMetadataIssues();
  const issuesAfterClean = await getMetadataIssues();
  expect(affectedAfterClean).toBe(affectedBefore);
  expect(issuesAfterClean.artistsWithoutGenre).toBe(issuesBefore.artistsWithoutGenre + 1);

  await prisma.track.create({
    data: {
      title: `Overlap ${uniqueId}`,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `overlap-${uniqueId}`,
      // Shorter than 5 seconds, and missing cover and year.
      duration: 3,
      year: null,
      coverImageId: null,
    },
  });

  const affectedAfterOverlap = await countTracksWithMetadataIssues();
  const issuesAfterOverlap = await getMetadataIssues();
  const totalTracks = await prisma.track.count();

  expect(totalTracks).toBe(totalTracksBefore + 2);
  expect(affectedAfterOverlap).toBe(affectedBefore + 1);
  expect(issuesAfterOverlap.suspiciousDurations).toBe(issuesBefore.suspiciousDurations + 1);
  expect(issuesAfterOverlap.missingEssentials).toBe(issuesBefore.missingEssentials + 1);
  expect(issuesAfterOverlap.artistsWithoutGenre).toBe(issuesBefore.artistsWithoutGenre + 1);

  const bucketSum =
    issuesAfterOverlap.placeholderTitles +
    issuesAfterOverlap.suspiciousDurations +
    issuesAfterOverlap.missingEssentials +
    issuesAfterOverlap.invalidYears +
    issuesAfterOverlap.artistsWithoutGenre;
  const percent = percentOfTracksAffected(affectedAfterOverlap, totalTracks);

  expect(bucketSum).toBeGreaterThan(affectedAfterOverlap);
  expect(percent).toBeGreaterThanOrEqual(0);
  expect(percent).toBeLessThanOrEqual(100);
  expect(percent).toBeCloseTo((affectedAfterOverlap / totalTracks) * 100);
});

test("storage stats keep going when an audio file's track row is gone", async () => {
  const suffix = `orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: {
      name: `Orphan Artist ${suffix}`,
      normalizedName: `orphan-artist-${suffix}`,
    },
  });
  const service = await prisma.service.create({
    data: {
      name: `orphan-service-${suffix}`,
      displayName: `Orphan Service ${suffix}`,
      baseUrl: "https://example.com",
    },
  });
  const track = await prisma.track.create({
    data: {
      title: `Orphaned file ${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `orphan-track-${suffix}`,
    },
  });
  const file = await prisma.trackAudioFile.create({
    data: {
      trackId: track.id,
      serviceId: service.id,
      objectKey: `orphan/${suffix}.mp3`,
      format: "mp3",
      fileSize: 2_000_000_000,
    },
  });

  try {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await prisma.$executeRaw`DELETE FROM Track WHERE id = ${track.id}`;
    const remaining = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count FROM TrackAudioFile WHERE id = ${file.id}
    `;
    expect(Number(remaining[0]?.count ?? 0)).toBe(1);

    const stats = await getStorageStats();
    const listed = stats.largestFiles.find((row) => row.id === file.id);
    expect(listed?.trackTitle).toBe("Missing track");
    expect(listed?.artistName).toBe("—");
    expect(stats.totalBytes).toBeGreaterThanOrEqual(2_000_000_000);

    const health = await getAdminOverviewHealth();
    expect(health.storageBytes).toBe(stats.totalBytes);
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await prisma.trackAudioFile.deleteMany({ where: { id: file.id } });
    await prisma.track.deleteMany({ where: { id: track.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.artist.deleteMany({ where: { id: artist.id } });
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
});

test("duplicate group count includes similar audio and matches the duplicates page", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const beforeAll = await loadDuplicateDashboard("all");
  const beforeExact = await loadDuplicateDashboard("exact");

  const artist = await prisma.artist.create({
    data: {
      name: `Dup Count Artist ${suffix}`,
      normalizedName: `dup-count-artist-${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const service = await prisma.service.create({
    data: {
      name: `dup-count-service-${suffix}`,
      displayName: `Dup Count Service ${suffix}`,
      baseUrl: "https://example.com",
    },
  });
  createdServiceIds.push(service.id);

  const fixtures = [
    { title: "Exact A", contentHash: `exact-${suffix}`, audioFingerprint: `exact-a-${suffix}` },
    { title: "Exact B", contentHash: `exact-${suffix}`, audioFingerprint: `exact-b-${suffix}` },
    {
      title: "Similar A",
      contentHash: `similar-a-${suffix}`,
      audioFingerprint: compressChromaprint(Array.from({ length: 20 }, (_, i) => 0x11110000 + i)),
    },
    {
      title: "Similar B",
      contentHash: `similar-b-${suffix}`,
      audioFingerprint: compressChromaprint(
        Array.from({ length: 20 }, (_, i) => 0x11110000 + i + (i === 5 ? 1 : 0)),
      ),
    },
  ];

  const tracks = await Promise.all(
    fixtures.map((fixture) =>
      prisma.track.create({
        data: {
          title: `${fixture.title} ${suffix}`,
          artistId: artist.id,
          serviceId: service.id,
          externalId: `quality-dup-${suffix}-${fixture.title.replace(/\s+/g, "-")}`,
          duration: 180,
          year: 2020,
          audioFiles: {
            create: {
              objectKey: `audio/quality-dup/${suffix}/${fixture.title.replace(/\s+/g, "-")}.mp3`,
              contentHash: fixture.contentHash,
              audioFingerprint: fixture.audioFingerprint,
              format: "mp3",
              fileName: `${fixture.title}.mp3`,
              fileSize: 4096,
              serviceId: service.id,
            },
          },
        },
      }),
    ),
  );
  createdTrackIds.push(...tracks.map((track) => track.id));

  const all = await loadDuplicateDashboard("all");
  const exact = await loadDuplicateDashboard("exact");
  const count = await getDuplicateTracksCount();

  expect(all.groups.some((group) => group.type === "similar")).toBe(true);
  expect(all.stats.duplicateGroups).toBe(beforeAll.stats.duplicateGroups + 2);
  expect(exact.stats.duplicateGroups).toBe(beforeExact.stats.duplicateGroups + 1);
  expect(count).toBe(all.stats.duplicateGroups);
  expect(count).toBeGreaterThan(exact.stats.duplicateGroups);
});

test("exact duplicate groups are ordered by count desc with oldest-first tracks", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: { name: `Batch Artist ${suffix}`, normalizedName: `batch-artist-${suffix}` },
  });
  createdArtistIds.push(artist.id);
  const service = await prisma.service.create({
    data: {
      name: `batch-service-${suffix}`,
      displayName: `Batch Service ${suffix}`,
      baseUrl: "https://example.com",
    },
  });
  createdServiceIds.push(service.id);

  // Three exact groups with 2, 4 and 3 tracks respectively.
  const fixtures = [
    { hash: `batch-2-${suffix}`, titles: ["two-a", "two-b"] },
    { hash: `batch-4-${suffix}`, titles: ["four-a", "four-b", "four-c", "four-d"] },
    { hash: `batch-3-${suffix}`, titles: ["three-a", "three-b", "three-c"] },
  ];

  for (const [groupIndex, fixture] of fixtures.entries()) {
    for (const [trackIndex, title] of fixture.titles.entries()) {
      const track = await prisma.track.create({
        data: {
          title: `${title} ${suffix}`,
          artistId: artist.id,
          serviceId: service.id,
          externalId: `batch-${suffix}-${groupIndex}-${trackIndex}`,
          duration: 180,
          audioFiles: {
            create: {
              objectKey: `audio/batch/${suffix}/${groupIndex}/${trackIndex}.mp3`,
              contentHash: fixture.hash,
              format: "mp3",
              fileSize: 4096,
              serviceId: service.id,
              createdAt: new Date(Date.UTC(2024, 0, 1, 0, trackIndex)),
            },
          },
        },
      });
      createdTrackIds.push(track.id);
    }
  }

  const dashboard = await loadDuplicateDashboard("exact");
  const groupHashes = dashboard.groups
    .filter((group) => group.type === "exact" && group.contentHash?.startsWith("batch-"))
    .map((group) => group.contentHash as string);

  // Largest group first, then the smaller ones, in duplicate-count order.
  expect(groupHashes.indexOf(`batch-4-${suffix}`)).toBeGreaterThanOrEqual(0);
  expect(groupHashes.indexOf(`batch-3-${suffix}`)).toBeGreaterThanOrEqual(0);
  expect(groupHashes.indexOf(`batch-2-${suffix}`)).toBeGreaterThanOrEqual(0);
  expect(groupHashes.indexOf(`batch-4-${suffix}`)).toBeLessThan(
    groupHashes.indexOf(`batch-3-${suffix}`),
  );
  expect(groupHashes.indexOf(`batch-3-${suffix}`)).toBeLessThan(
    groupHashes.indexOf(`batch-2-${suffix}`),
  );

  // Tracks within a group stay oldest-first.
  const fourGroup = dashboard.groups.find((group) => group.contentHash === `batch-4-${suffix}`);
  expect(fourGroup?.tracks.map((track) => track.title)).toEqual([
    `four-a ${suffix}`,
    `four-b ${suffix}`,
    `four-c ${suffix}`,
    `four-d ${suffix}`,
  ]);
});

test("getDatabaseQualitySnapshot caches aggregates and keeps lastUpdated stable", async () => {
  // Reset the cache so this test is deterministic regardless of prior runs.
  await cache.delete(DATABASE_QUALITY_CACHE_KEY);

  const first = await getDatabaseQualitySnapshot();

  // Mutate the database: a fresh compute would see this new track, a cached
  // read must not.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: { name: `Cache Artist ${suffix}`, normalizedName: `cache-artist-${suffix}` },
  });
  createdArtistIds.push(artist.id);
  const service = await prisma.service.create({
    data: {
      name: `cache-service-${suffix}`,
      displayName: `Cache Service ${suffix}`,
      baseUrl: "https://example.com",
    },
  });
  createdServiceIds.push(service.id);
  const track = await prisma.track.create({
    data: {
      title: `Cache Track ${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `cache-track-${suffix}`,
      duration: 180,
    },
  });
  createdTrackIds.push(track.id);

  const second = await getDatabaseQualitySnapshot();

  // Cached: the new track is not counted and the "last updated" timestamp has
  // not advanced (it only refreshes when the data actually refreshes).
  expect(second.totalTracks).toBe(first.totalTracks);
  expect(second.lastUpdated).toBe(first.lastUpdated);

  await cache.delete(DATABASE_QUALITY_CACHE_KEY);
});
