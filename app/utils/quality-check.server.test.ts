import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import {
  QUALITY_CHECK_RETRY_DELAY_MS,
  QUALITY_CHECK_TICK_INTERVAL_MS,
  processQualityCheckTick,
  resetQualityCheckSchedulerForTests,
  runQualityCheck,
  scheduleQualityCheck,
  stopQualityCheckScheduler,
} from "./quality-check.server.ts";

vi.mock("#app/utils/litefs.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/litefs.server.ts")>();
  return {
    ...actual,
    getInstanceInfo: vi.fn(async () => ({
      currentIsPrimary: true,
      primaryInstance: "test",
      currentInstance: "test",
    })),
  };
});

const createdTrackIds: string[] = [];
const createdAlbumIds: string[] = [];
const createdArtistIds: string[] = [];
const createdCoverIds: string[] = [];

async function createService() {
  return prisma.service.upsert({
    where: { name: "quality-check-test" },
    update: {},
    create: {
      name: "quality-check-test",
      displayName: "Quality Check Test",
      baseUrl: "http://localhost",
      isActive: true,
    },
  });
}

async function createArtist() {
  const artist = await prisma.artist.create({
    data: {
      name: "Quality Check Artist",
      normalizedName: `qc-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  createdArtistIds.push(artist.id);
  return artist;
}

async function createCover(width: number, height: number) {
  const key = `qc-cover-${Math.random().toString(36).slice(2, 10)}`;
  const cover = await prisma.coverImage.create({
    data: {
      contentHash: key,
      objectKey: key,
      width,
      height,
      format: "jpeg",
    },
  });
  createdCoverIds.push(cover.id);
  return cover;
}

async function createTrack(fields: {
  albumId?: string | null;
  genre?: string | null;
  duration?: number | null;
  coverImageId?: string | null;
}) {
  const service = await createService();
  const artist = await createArtist();
  const track = await prisma.track.create({
    data: {
      title: "Quality Check Track",
      artistId: artist.id,
      serviceId: service.id,
      externalId: `qc-${Math.random().toString(36).slice(2, 10)}`,
      albumId: fields.albumId,
      genre: fields.genre,
      duration: fields.duration,
      coverImageId: fields.coverImageId,
    },
  });
  createdTrackIds.push(track.id);
  return track;
}

function summarize(
  items: Array<{
    entityType: string;
    source: string;
    issueType: string;
    description: string | null;
    status: string;
    priority: number;
  }>,
) {
  return items
    .map((item) => ({
      entityType: item.entityType,
      source: item.source,
      issueType: item.issueType,
      description: item.description,
      status: item.status,
      priority: item.priority,
    }))
    .sort((a, b) => (a.description ?? "").localeCompare(b.description ?? ""));
}

afterEach(async () => {
  stopQualityCheckScheduler();
  resetQualityCheckSchedulerForTests();
  vi.useRealTimers();

  if (createdTrackIds.length) {
    await prisma.reviewQueueItem.deleteMany({ where: { entityId: { in: createdTrackIds } } });
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdAlbumIds.length) {
    await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
    createdAlbumIds.length = 0;
  }
  if (createdCoverIds.length) {
    await prisma.coverImage.deleteMany({ where: { id: { in: createdCoverIds } } });
    createdCoverIds.length = 0;
  }
  if (createdArtistIds.length) {
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
});

describe("runQualityCheck", () => {
  test("one run creates system queue rows for missing album, genre, low-resolution covers, and zero duration", async () => {
    const cover = await createCover(200, 100);
    const track = await createTrack({
      albumId: null,
      genre: "   ",
      duration: 0,
      coverImageId: cover.id,
    });
    const artist = await createArtist();
    const album = await prisma.album.create({
      data: { name: "Complete Album", artistId: artist.id },
    });
    createdAlbumIds.push(album.id);
    const fineCover = await createCover(300, 300);
    const complete = await createTrack({
      albumId: album.id,
      genre: "Jazz",
      duration: 180,
      coverImageId: fineCover.id,
    });
    const nullDuration = await createTrack({
      albumId: album.id,
      genre: "Jazz",
      duration: null,
    });

    const result = await runQualityCheck();
    expect(result.success).toBe(true);

    const created = await prisma.reviewQueueItem.findMany({ where: { entityId: track.id } });
    expect(summarize(created)).toEqual([
      {
        entityType: "track",
        source: "system",
        issueType: "low_quality",
        description: "Cover image resolution is too low (200x100px, minimum 300x300px)",
        status: "open",
        priority: 1,
      },
      {
        entityType: "track",
        source: "system",
        issueType: "missing_info",
        description: "Track has zero duration",
        status: "open",
        priority: 2,
      },
      {
        entityType: "track",
        source: "system",
        issueType: "missing_info",
        description: "Track is missing album information",
        status: "open",
        priority: 2,
      },
      {
        entityType: "track",
        source: "system",
        issueType: "missing_info",
        description: "Track is missing genre information",
        status: "open",
        priority: 2,
      },
    ]);

    const firstIds = created.map((item) => item.id).sort();
    await runQualityCheck();
    const second = await prisma.reviewQueueItem.findMany({ where: { entityId: track.id } });
    expect(second.map((item) => item.id).sort()).toEqual(firstIds);

    const untouched = await prisma.reviewQueueItem.count({
      where: { entityId: { in: [complete.id, nullDuration.id] } },
    });
    expect(untouched).toBe(0);
  });

  test("does not duplicate an existing open or claimed system item", async () => {
    const openTrack = await createTrack({ genre: "Jazz", duration: 10 });
    const claimedTrack = await createTrack({ genre: "Jazz", duration: 10 });
    const reportedTrack = await createTrack({ genre: "Jazz", duration: 10 });

    const openItem = await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: openTrack.id,
        source: "system",
        issueType: "missing_info",
        description: "already open",
        status: "open",
        priority: 2,
      },
    });
    const claimedItem = await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: claimedTrack.id,
        source: "system",
        issueType: "missing_info",
        description: "already claimed",
        status: "claimed",
        priority: 2,
      },
    });
    await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: reportedTrack.id,
        source: "user_report",
        issueType: "missing_info",
        description: "user report",
        status: "open",
        priority: 2,
      },
    });

    await runQualityCheck();

    const openItems = await prisma.reviewQueueItem.findMany({
      where: { entityId: openTrack.id, source: "system" },
    });
    expect(openItems.map((item) => item.id)).toEqual([openItem.id]);
    expect(openItems[0]?.description).toBe("already open");

    const claimedItems = await prisma.reviewQueueItem.findMany({
      where: { entityId: claimedTrack.id, source: "system" },
    });
    expect(claimedItems.map((item) => item.id)).toEqual([claimedItem.id]);

    const systemReports = await prisma.reviewQueueItem.findMany({
      where: { entityId: reportedTrack.id, source: "system", status: "open" },
    });
    expect(systemReports).toHaveLength(1);
    expect(systemReports[0]).toMatchObject({
      issueType: "missing_info",
      description: "Track is missing album information",
      priority: 2,
    });
  });
});

describe("scheduleQualityCheck", () => {
  test("registers a single interval and does not tight-loop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T01:00:00.000Z"));
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    scheduleQualityCheck();
    scheduleQualityCheck();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      QUALITY_CHECK_TICK_INTERVAL_MS,
    );
    expect(QUALITY_CHECK_TICK_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);

    await vi.advanceTimersByTimeAsync(QUALITY_CHECK_TICK_INTERVAL_MS);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  test("runs once per UTC day at or after 02:00 and retries a failure without scanning every tick", async () => {
    resetQualityCheckSchedulerForTests();
    const run = vi
      .fn<typeof runQualityCheck>()
      .mockResolvedValueOnce({ success: false, error: "db down" })
      .mockResolvedValue({ success: true, tracksChecked: 1, issuesFound: 0 });

    await processQualityCheckTick({
      now: new Date("2026-10-04T01:59:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).not.toHaveBeenCalled();

    await processQualityCheckTick({
      now: new Date("2026-10-04T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await processQualityCheckTick({
      now: new Date("2026-10-04T02:01:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);

    await processQualityCheckTick({
      now: new Date(new Date("2026-10-04T02:00:00.000Z").getTime() + QUALITY_CHECK_RETRY_DELAY_MS),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);

    await processQualityCheckTick({
      now: new Date("2026-10-04T18:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);

    await processQualityCheckTick({
      now: new Date("2026-10-05T02:00:00.000Z"),
      skipPrimaryCheck: true,
      run,
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  test("does not run on a LiteFS replica", async () => {
    resetQualityCheckSchedulerForTests();
    vi.mocked(getInstanceInfo).mockResolvedValueOnce({
      currentIsPrimary: false,
      primaryInstance: "primary",
      currentInstance: "replica",
    });
    const run = vi.fn<typeof runQualityCheck>(async () => ({
      success: true,
      tracksChecked: 0,
      issuesFound: 0,
    }));

    await processQualityCheckTick({
      now: new Date("2026-10-04T02:30:00.000Z"),
      run,
    });

    expect(run).not.toHaveBeenCalled();
  });
});
