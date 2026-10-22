import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  getOnRepeatSnapshotDetail,
  listOnRepeatSnapshotHistory,
  listOnRepeatSnapshotShelf,
} from "./queries.server.ts";

async function createTrack(title: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
}

async function createSnapshot({
  userId,
  yearMonth,
  trackIds,
}: {
  userId: string;
  yearMonth: string;
  trackIds: string[];
}) {
  return prisma.onRepeatSnapshot.create({
    data: {
      userId,
      yearMonth,
      tracks: {
        create: trackIds.map((trackId, position) => ({
          trackId,
          position,
          listenCount: 10 - position,
        })),
      },
    },
  });
}

describe("on-repeat snapshot queries", () => {
  beforeEach(async () => {
    await prisma.onRepeatSnapshotTrack.deleteMany();
    await prisma.onRepeatSnapshot.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("shelf returns latest 3 by yearMonth desc", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const track = await createTrack("A");
    for (const month of ["2026-05", "2026-06", "2026-07", "2026-08"]) {
      await createSnapshot({ userId: user.id, yearMonth: month, trackIds: [track.id] });
    }

    const shelf = await listOnRepeatSnapshotShelf(user.id);
    expect(shelf.map((s) => s.yearMonth)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(shelf[0]?.trackCount).toBe(1);
  });

  test("history lists all snapshots newest first", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const track = await createTrack("A");
    for (const month of ["2026-05", "2026-06", "2026-07", "2026-08"]) {
      await createSnapshot({ userId: user.id, yearMonth: month, trackIds: [track.id] });
    }

    const { items, nextCursor } = await listOnRepeatSnapshotHistory({ userId: user.id });
    expect(items.map((s) => s.yearMonth)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(nextCursor).toBeNull();
  });

  test("detail returns ranked tracks with listen counts for owner only", async () => {
    const owner = await prisma.user.create({ data: createUser() });
    const other = await prisma.user.create({ data: createUser() });
    const trackA = await createTrack("A");
    const trackB = await createTrack("B");
    const snapshot = await createSnapshot({
      userId: owner.id,
      yearMonth: "2026-08",
      trackIds: [trackA.id, trackB.id],
    });

    const detail = await getOnRepeatSnapshotDetail({
      userId: owner.id,
      snapshotId: snapshot.id,
    });
    expect(detail?.yearMonth).toBe("2026-08");
    expect(detail?.tracks.map((t) => t.track.id)).toEqual([trackA.id, trackB.id]);
    expect(detail?.tracks[0]?.listenCount).toBe(10);

    const denied = await getOnRepeatSnapshotDetail({
      userId: other.id,
      snapshotId: snapshot.id,
    });
    expect(denied).toBeNull();
  });
});
