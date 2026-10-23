import { afterEach, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { QUEUE_STATUS_MINE } from "./review-queue.ts";
import {
  createOrUpdateQueueItem,
  listReviewQueue,
  releaseStaleClaims,
} from "./review-queue.server.ts";

const createdUserIds: string[] = [];
const createdTrackIds: string[] = [];
const createdAlbumIds: string[] = [];
const createdArtistIds: string[] = [];

async function createCurator(name: string) {
  await prisma.role.upsert({
    where: { name: "curator" },
    update: {},
    create: { name: "curator", description: "curator" },
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `${name}-${suffix}@example.com`,
      username: `${name}${suffix}`.replaceAll(/[^a-z0-9]/gi, "").slice(0, 30),
      name,
      roles: { connect: { name: "curator" } },
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createTrack(title: string) {
  const service = await prisma.service.upsert({
    where: { name: "review-queue-test" },
    update: {},
    create: {
      name: "review-queue-test",
      displayName: "Review Queue Test",
      baseUrl: "http://localhost",
      isActive: true,
    },
  });
  const artist = await prisma.artist.create({
    data: {
      name: "Miles Davis",
      normalizedName: `miles-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  createdArtistIds.push(artist.id);
  const album = await prisma.album.create({
    data: { name: "Kind of Blue", artistId: artist.id },
  });
  createdAlbumIds.push(album.id);
  const track = await prisma.track.create({
    data: {
      title,
      artistId: artist.id,
      albumId: album.id,
      serviceId: service.id,
      externalId: `queue-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  createdTrackIds.push(track.id);
  return { track, artist, album };
}

afterEach(async () => {
  if (createdTrackIds.length) {
    await prisma.reviewQueueItem.deleteMany({ where: { entityId: { in: createdTrackIds } } });
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdAlbumIds.length) {
    await prisma.reviewQueueItem.deleteMany({ where: { entityId: { in: createdAlbumIds } } });
    await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
    createdAlbumIds.length = 0;
  }
  if (createdArtistIds.length) {
    await prisma.reviewQueueItem.deleteMany({ where: { entityId: { in: createdArtistIds } } });
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

test("queue items show the entity title or name instead of its id", async () => {
  const { track, artist, album } = await createTrack("So What");
  await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "user_report",
      issueType: "wrong_metadata",
      description: "The artist credit is wrong",
      status: "open",
      priority: 3,
    },
  });
  await prisma.reviewQueueItem.create({
    data: {
      entityType: "artist",
      entityId: artist.id,
      source: "curator",
      issueType: "duplicate",
      description: "Same person as another artist",
      status: "open",
      priority: 3,
    },
  });
  await prisma.reviewQueueItem.create({
    data: {
      entityType: "album",
      entityId: album.id,
      source: "system",
      issueType: "missing_info",
      description: "Year is missing",
      status: "open",
      priority: 3,
    },
  });

  const result = await listReviewQueue({ status: "open", page: 1 });
  const byId = new Map(result.items.map((item) => [item.entityId, item]));

  expect(byId.get(track.id)?.entityDetails.name).toBe("So What — Miles Davis");
  expect(byId.get(artist.id)?.entityDetails.name).toBe("Miles Davis");
  expect(byId.get(album.id)?.entityDetails.name).toBe("Kind of Blue — Miles Davis");
  expect(byId.get(track.id)?.entityDetails.name).not.toBe(track.id);
  expect(byId.get(artist.id)?.entityDetails.name).not.toBe(artist.id);
  expect(byId.get(album.id)?.entityDetails.name).not.toBe(album.id);
});

test("my claims lists only reports claimed by that curator", async () => {
  const owner = await createCurator("Ada");
  const other = await createCurator("Grace");
  const { track } = await createTrack("Blue in Green");
  const mine = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "user_report",
      issueType: "low_quality",
      description: "Audio cuts out at the end",
      status: "claimed",
      claimedBy: owner.id,
      claimedAt: new Date(),
    },
  });
  await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "user_report",
      issueType: "other",
      description: "Someone else's claim",
      status: "claimed",
      claimedBy: other.id,
      claimedAt: new Date(),
    },
  });
  await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "system",
      issueType: "missing_info",
      description: "Still open",
      status: "open",
    },
  });

  const result = await listReviewQueue({
    status: QUEUE_STATUS_MINE,
    claimedBy: owner.id,
  });

  expect(result.items.map((item) => item.id)).toEqual([mine.id]);
  expect(result.items[0]?.description).toBe("Audio cuts out at the end");
  expect(result.items[0]?.entityDetails.name).toContain("Blue in Green");
});

test("my claims is empty when the curator is not identified", async () => {
  const result = await listReviewQueue({ status: QUEUE_STATUS_MINE });
  expect(result.items).toEqual([]);
  expect(result.total).toBe(0);
});

test("a listener's report list includes only reports they filed", async () => {
  const owner = await createCurator("Ada");
  const other = await createCurator("Grace");
  const { track } = await createTrack("Flamenco Sketches");
  const mine = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "user_report",
      issueType: "wrong_metadata",
      description: "The title is misspelled",
      reporterId: owner.id,
      status: "open",
    },
  });
  await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "user_report",
      issueType: "other",
      description: "Someone else's report",
      reporterId: other.id,
      status: "open",
    },
  });

  const result = await listReviewQueue({ status: "all", reporterId: owner.id });

  expect(result.items.map((item) => item.id)).toEqual([mine.id]);
  expect(result.items[0]?.entityDetails.name).toContain("Flamenco Sketches");
  expect(result.items[0]?.entityDetails.name).not.toBe(track.id);
});

test("createOrUpdateQueueItem dedupes open user reports and increments reportCount", async () => {
  const { track } = await createTrack("Dedup Report");
  const reporter = await createCurator("DedupUser");

  const first = await createOrUpdateQueueItem({
    entityType: "track",
    entityId: track.id,
    source: "user_report",
    issueType: "wrong_metadata",
    description: "First report",
    reporterId: reporter.id,
    priority: 1,
  });
  expect(first.created).toBe(true);

  const second = await createOrUpdateQueueItem({
    entityType: "track",
    entityId: track.id,
    source: "user_report",
    issueType: "wrong_metadata",
    description: "Duplicate report",
    reporterId: reporter.id,
    priority: 1,
  });
  expect(second.created).toBe(false);
  expect(second.id).toBe(first.id);

  const item = await prisma.reviewQueueItem.findUniqueOrThrow({ where: { id: first.id } });
  expect(item.reportCount).toBe(2);

  const count = await prisma.reviewQueueItem.count({
    where: {
      entityType: "track",
      entityId: track.id,
      source: "user_report",
      issueType: "wrong_metadata",
      status: "open",
    },
  });
  expect(count).toBe(1);
});

test("releaseStaleClaims resets claims older than 2h back to open and leaves recent claims alone", async () => {
  const owner = await createCurator("StaleOwner");
  const { track } = await createTrack("Stale Claim");

  const stale = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "system",
      issueType: "missing_info",
      status: "claimed",
      claimedBy: owner.id,
      claimedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
  });
  const fresh = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: "system",
      issueType: "low_quality",
      status: "claimed",
      claimedBy: owner.id,
      claimedAt: new Date(Date.now() - 60 * 1000),
    },
  });

  const released = await releaseStaleClaims(new Date());

  expect(released).toBeGreaterThanOrEqual(1);

  const staleAfter = await prisma.reviewQueueItem.findUniqueOrThrow({ where: { id: stale.id } });
  expect(staleAfter.status).toBe("open");
  expect(staleAfter.claimedBy).toBeNull();
  expect(staleAfter.claimedAt).toBeNull();

  const freshAfter = await prisma.reviewQueueItem.findUniqueOrThrow({ where: { id: fresh.id } });
  expect(freshAfter.status).toBe("claimed");
  expect(freshAfter.claimedBy).toBe(owner.id);
});

test("open queue orders by priority desc then oldest-first (FIFO) within a priority", async () => {
  const { track } = await createTrack("FIFO Ordering");
  const uniqueSource = `fifo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const highPriority = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: uniqueSource,
      issueType: "duplicate",
      status: "open",
      priority: 3,
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
    },
  });
  const older = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: uniqueSource,
      issueType: "missing_info",
      status: "open",
      priority: 2,
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    },
  });
  const newer = await prisma.reviewQueueItem.create({
    data: {
      entityType: "track",
      entityId: track.id,
      source: uniqueSource,
      issueType: "low_quality",
      status: "open",
      priority: 2,
      createdAt: new Date(Date.now()),
    },
  });

  const result = await listReviewQueue({ status: "open", source: uniqueSource });

  expect(result.items.map((item) => item.id)).toEqual([highPriority.id, older.id, newer.id]);
});
