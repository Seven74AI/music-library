import { afterEach, describe, expect, test } from "vitest";
import { cache } from "#app/utils/cache.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { DASHBOARD_METRICS_CACHE_KEY, lastNDays } from "./dashboard.ts";
import {
  computeDashboardMetrics,
  getActivity,
  getDashboardCharts,
  getDashboardMetrics,
  getLeaderboard,
} from "./dashboard.server.ts";

const createdUserIds: string[] = [];
const createdTrackIds: string[] = [];
const createdAlbumIds: string[] = [];
const createdArtistIds: string[] = [];

async function ensureRole(name: string) {
  await prisma.role.upsert({
    where: { name },
    update: {},
    create: { name, description: name },
  });
}

async function createCurator(name: string) {
  await ensureRole("curator");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `${name}-${suffix}@example.com`,
      username: `${name}${suffix}`.slice(0, 30),
      name,
      roles: { connect: { name: "curator" } },
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createTrack(
  title: string,
  fields?: { genre?: string; year?: number; bpm?: number; albumId?: string },
) {
  const service = await prisma.service.upsert({
    where: { name: "curator-dashboard-test" },
    update: {},
    create: {
      name: "curator-dashboard-test",
      displayName: "Curator Dashboard Test",
      baseUrl: "http://localhost",
      isActive: true,
    },
  });
  const artist = await prisma.artist.create({
    data: {
      name: `Artist ${title}`,
      normalizedName: `artist-${title}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
    },
  });
  createdArtistIds.push(artist.id);
  const track = await prisma.track.create({
    data: {
      title,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `dash-${title}-${Math.random().toString(36).slice(2, 8)}`,
      genre: fields?.genre,
      year: fields?.year,
      bpm: fields?.bpm,
      albumId: fields?.albumId,
    },
  });
  createdTrackIds.push(track.id);
  return { track, artist, service };
}

afterEach(async () => {
  await cache.delete(DASHBOARD_METRICS_CACHE_KEY);
  if (createdTrackIds.length) {
    await prisma.reviewQueueItem.deleteMany({ where: { entityId: { in: createdTrackIds } } });
    await prisma.trackEdit.deleteMany({ where: { trackId: { in: createdTrackIds } } });
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdAlbumIds.length) {
    await prisma.albumEdit.deleteMany({ where: { albumId: { in: createdAlbumIds } } });
    await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
    createdAlbumIds.length = 0;
  }
  if (createdArtistIds.length) {
    await prisma.artistEdit.deleteMany({ where: { artistId: { in: createdArtistIds } } });
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
  await prisma.duplicateDetection.deleteMany({
    where: { normalizedName: { startsWith: "dash-dupe-" } },
  });
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("dashboard metrics", () => {
  test("counts missing metadata, queue items, and open duplicates", async () => {
    const before = await computeDashboardMetrics();
    const { track } = await createTrack("Incomplete Dash Track");
    await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: track.id,
        source: "system",
        issueType: "missing_info",
        status: "open",
      },
    });
    await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: track.id,
        source: "curator",
        issueType: "wrong_metadata",
        status: "resolved",
      },
    });
    await prisma.duplicateDetection.createMany({
      data: [
        {
          entityType: "artist",
          entityId1: "a",
          entityId2: "b",
          matchType: "exact",
          similarity: 0,
          normalizedName: "dash-dupe-exact",
          status: "pending",
        },
        {
          entityType: "album",
          entityId1: "c",
          entityId2: "d",
          matchType: "fuzzy",
          similarity: 2,
          normalizedName: "dash-dupe-fuzzy",
          status: "pending",
        },
        {
          entityType: "artist",
          entityId1: "e",
          entityId2: "f",
          matchType: "exact",
          similarity: 0,
          normalizedName: "dash-dupe-dismissed",
          status: "dismissed",
        },
      ],
    });

    const after = await computeDashboardMetrics();
    expect(after.totalTracks).toBe(before.totalTracks + 1);
    expect(after.tracksMissingMetadata).toBe(before.tracksMissingMetadata + 1);
    expect(after.pendingQueueItems).toBe(before.pendingQueueItems + 1);
    expect(after.openDuplicatesExact).toBe(before.openDuplicatesExact + 1);
    expect(after.openDuplicatesFuzzy).toBe(before.openDuplicatesFuzzy + 1);
    expect(after.openDuplicates).toBe(before.openDuplicates + 2);

    const problem = after.problemTracks.find((row) => row.id === track.id);
    expect(problem?.issues).toEqual(
      expect.arrayContaining([
        "Missing album",
        "Missing genre",
        "Missing year",
        "Missing BPM",
        "1 open queue item",
      ]),
    );
  });

  test("reuses cached metrics until refresh", async () => {
    const first = await getDashboardMetrics({ forceFresh: true });
    await createTrack("Cached Dash Track");
    const cached = await getDashboardMetrics();
    expect(cached.totalTracks).toBe(first.totalTracks);
    const fresh = await getDashboardMetrics({ forceFresh: true });
    expect(fresh.totalTracks).toBe(first.totalTracks + 1);
  });
});

describe("curator leaderboard", () => {
  test("ranks edit counts for the requested period", async () => {
    const now = new Date("2026-10-02T15:00:00.000Z");
    const alice = await createCurator("Alice");
    const bob = await createCurator("Bob");
    const { track, artist } = await createTrack("Leaderboard Track");
    const album = await prisma.album.create({
      data: { name: "Leaderboard Album", artistId: artist.id },
    });
    createdAlbumIds.push(album.id);

    await prisma.trackEdit.createMany({
      data: [
        {
          trackId: track.id,
          editedBy: alice.id,
          title: track.title,
          artistId: artist.id,
          editedAt: now,
        },
        {
          trackId: track.id,
          editedBy: alice.id,
          title: track.title,
          artistId: artist.id,
          editedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ],
    });
    await prisma.artistEdit.create({
      data: {
        artistId: artist.id,
        editedBy: alice.id,
        name: artist.name,
        editedAt: now,
        comment: "Merged into Queen: duplicate",
      },
    });
    await prisma.albumEdit.create({
      data: {
        albumId: album.id,
        editedBy: bob.id,
        name: album.name,
        artistId: artist.id,
        editedAt: now,
      },
    });

    const week = await getLeaderboard({ period: "week", limit: 50, now });
    const aliceWeek = week.entries.find((entry) => entry.curator.id === alice.id);
    const bobWeek = week.entries.find((entry) => entry.curator.id === bob.id);
    expect(aliceWeek?.editCount).toBe(2);
    expect(bobWeek?.editCount).toBe(1);
    expect(aliceWeek && bobWeek && aliceWeek.rank < bobWeek.rank).toBe(true);

    const allTime = await getLeaderboard({ period: "all", limit: 50, now });
    expect(allTime.entries.find((entry) => entry.curator.id === alice.id)?.editCount).toBe(3);

    const today = await getLeaderboard({ period: "today", limit: 50, now });
    expect(today.entries.find((entry) => entry.curator.id === alice.id)?.editCount).toBe(2);
  });
});

describe("curator activity", () => {
  test("formats recent edits, merges, and splits and paginates", async () => {
    const now = new Date("2026-10-02T12:02:00.000Z");
    const alice = await createCurator("Alice");
    const { track, artist } = await createTrack("Track X");
    await prisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: alice.id,
        title: "Track X",
        artistId: artist.id,
        editedAt: new Date("2026-10-02T12:00:00.000Z"),
      },
    });
    await prisma.artistEdit.create({
      data: {
        artistId: artist.id,
        editedBy: alice.id,
        name: artist.name,
        comment: "SPLIT: side project",
        editedAt: new Date("2026-10-02T12:01:00.000Z"),
      },
    });

    const page = await getActivity({ curatorId: alice.id, page: 1, pageSize: 20, now });
    expect(page.items.map((item) => item.message)).toEqual([
      `Alice split '${artist.name}' (1 minute ago)`,
      "Alice edited 'Track X — Artist Track X' (2 minutes ago)",
    ]);
    expect(page.items[0]?.action).toBe("split");
    expect(page.items[0]?.matter).toBe("Split: side project");
    expect(page.items[1]?.action).toBe("edited");
    expect(page.items[1]?.entityName).toBe("Track X — Artist Track X");
    expect(page.items[1]?.matter).toBeNull();

    await prisma.trackEdit.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        trackId: track.id,
        editedBy: alice.id,
        title: "Track X",
        artistId: artist.id,
        editedAt: new Date(now.getTime() - (index + 3) * 60_000),
      })),
    });
    const first = await getActivity({ curatorId: alice.id, page: 1, pageSize: 20, now });
    const second = await getActivity({ curatorId: alice.id, page: 2, pageSize: 20, now });
    expect(first.total).toBe(22);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(2);
    expect(second.totalPages).toBe(2);
  });
});

describe("dashboard charts", () => {
  test("includes a new edit in today's bar", async () => {
    const before = await getDashboardCharts();
    const alice = await createCurator("Alice");
    const { track, artist } = await createTrack("Chart Track");
    await prisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: alice.id,
        title: track.title,
        artistId: artist.id,
      },
    });
    const after = await getDashboardCharts();
    const today = lastNDays(30).at(-1)!;
    const beforeCount = before.editsPerDay.find((row) => row.date === today)?.count ?? 0;
    const afterCount = after.editsPerDay.find((row) => row.date === today)?.count ?? 0;
    expect(afterCount).toBe(beforeCount + 1);
    expect(after.completenessOverTime).toHaveLength(30);
  });
});
