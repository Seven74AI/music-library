import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { awardCuratorBadges, loadCuratorCounts, resetBadgeAwardCache } from "./badges.server.ts";

const createdUserIds: string[] = [];
const createdTrackIds: string[] = [];
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

async function createTrack(title: string, genre = "Jazz") {
  const service = await prisma.service.upsert({
    where: { name: "curator-badges-test" },
    update: {},
    create: {
      name: "curator-badges-test",
      displayName: "Curator Badges Test",
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
      externalId: `badge-${title}-${Math.random().toString(36).slice(2, 8)}`,
      genre,
    },
  });
  createdTrackIds.push(track.id);
  return { track, artist };
}

afterEach(async () => {
  resetBadgeAwardCache();
  if (createdTrackIds.length) {
    await prisma.reviewQueueItem.deleteMany({ where: { entityId: { in: createdTrackIds } } });
    await prisma.trackEdit.deleteMany({ where: { trackId: { in: createdTrackIds } } });
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdArtistIds.length) {
    await prisma.artistEdit.deleteMany({ where: { artistId: { in: createdArtistIds } } });
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
  if (createdUserIds.length) {
    await prisma.curatorBadge.deleteMany({ where: { curatorId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("awardCuratorBadges", () => {
  test("parallel awards insert a new badge once", async () => {
    const curator = await createCurator("ParallelBadge");
    const { track, artist } = await createTrack("Parallel Track");
    await prisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: curator.id,
        title: track.title,
        artistId: artist.id,
        genre: "Jazz",
      },
    });
    resetBadgeAwardCache();

    const [first, second] = await Promise.all([
      awardCuratorBadges({ force: true }),
      awardCuratorBadges({ force: true }),
    ]);

    expect(first.awarded + second.awarded).toBe(1);
    expect(await prisma.curatorBadge.count({ where: { curatorId: curator.id } })).toBe(1);
  });

  test("9 edits do not store Getting Started and the 10th does, once", async () => {
    const curator = await createCurator("BadgeCurator");
    const { track, artist } = await createTrack("Badge Track");
    await prisma.trackEdit.createMany({
      data: Array.from({ length: 9 }, () => ({
        trackId: track.id,
        editedBy: curator.id,
        title: track.title,
        artistId: artist.id,
        genre: "Jazz",
      })),
    });

    await awardCuratorBadges({ force: true });
    const before = await prisma.curatorBadge.findMany({ where: { curatorId: curator.id } });
    expect(before.map((badge) => badge.badgeType)).toEqual(["first_edit"]);

    await prisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: curator.id,
        title: track.title,
        artistId: artist.id,
        genre: "Jazz",
      },
    });
    const firstAward = await awardCuratorBadges({ force: true });
    expect(firstAward.awarded).toBe(1);
    const after = await prisma.curatorBadge.findMany({
      where: { curatorId: curator.id },
      orderBy: { badgeType: "asc" },
    });
    expect(after.map((badge) => badge.badgeType).sort()).toEqual(["first_edit", "getting_started"]);

    const secondAward = await awardCuratorBadges({ force: true });
    expect(secondAward.awarded).toBe(0);
    expect(await prisma.curatorBadge.count({ where: { curatorId: curator.id } })).toBe(2);
  });

  test("overlapping awards store each badge once", async () => {
    const curator = await createCurator("RaceCurator");
    const { track, artist } = await createTrack("Race Track");
    await prisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: curator.id,
        title: track.title,
        artistId: artist.id,
        genre: "Jazz",
      },
    });
    resetBadgeAwardCache();

    const results = await Promise.all([awardCuratorBadges(), awardCuratorBadges()]);

    expect(results.filter((result) => result.skipped)).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.awarded, 0)).toBe(1);
    expect(
      (await prisma.curatorBadge.findMany({ where: { curatorId: curator.id } })).map(
        (badge) => badge.badgeType,
      ),
    ).toEqual(["first_edit"]);
  });

  test("counts merges, genre changes, and resolved user reports without awarding early", async () => {
    const curator = await createCurator("StatsCurator");
    const { track, artist } = await createTrack("Genre Track", "Jazz");
    await prisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: curator.id,
        title: track.title,
        artistId: artist.id,
        genre: "Rock",
      },
    });
    await prisma.artistEdit.create({
      data: {
        artistId: artist.id,
        editedBy: curator.id,
        name: artist.name,
        comment: "MERGE: duplicate",
      },
    });
    await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: track.id,
        source: "user_report",
        issueType: "wrong_metadata",
        status: "resolved",
        resolvedBy: curator.id,
        resolution: "fixed",
        resolutionComment: "Fixed the genre",
      },
    });

    const counts = await loadCuratorCounts();
    const mine = counts.get(curator.id);
    expect(mine).toMatchObject({
      edits: 2,
      merges: 1,
      queueResolutions: 1,
      genreEdits: 1,
      resolvedUserReports: 1,
    });

    await awardCuratorBadges({ force: true });
    const types = (await prisma.curatorBadge.findMany({ where: { curatorId: curator.id } })).map(
      (badge) => badge.badgeType,
    );
    expect(types).toContain("first_edit");
    expect(types).not.toContain("getting_started");
    expect(types).not.toContain("duplicate_hunter");
    expect(types).not.toContain("genre_specialist");
    expect(types).not.toContain("community_helper");
    expect(types).not.toContain("quality_guardian");
  });
});
