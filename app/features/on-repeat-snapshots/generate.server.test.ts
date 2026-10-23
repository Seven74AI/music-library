import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  generateOnRepeatSnapshotForUser,
  generateOnRepeatSnapshotsForMonth,
  rankPlayCompletedTracks,
} from "./generate.server.ts";
import { yearMonthToUtcWindow } from "./month.ts";

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

async function recordCompleted({
  userId,
  trackId,
  createdAt,
}: {
  userId: string;
  trackId: string;
  createdAt: Date;
}) {
  await prisma.usageEvent.create({
    data: {
      type: USAGE_EVENT_TYPES.play_completed,
      userId,
      trackId,
      createdAt,
    },
  });
}

describe("rankPlayCompletedTracks", () => {
  beforeEach(async () => {
    await prisma.onRepeatSnapshotTrack.deleteMany();
    await prisma.onRepeatSnapshot.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("ranks by play_completed count descending and ignores play_started", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const top = await createTrack("Top");
    const mid = await createTrack("Mid");
    const low = await createTrack("Low");
    const { windowStart, windowEndExclusive } = yearMonthToUtcWindow("2026-08");

    // top: 3 completes, mid: 2, low: 1; plus noise play_started / out-of-window
    for (let i = 0; i < 3; i++) {
      await recordCompleted({
        userId: user.id,
        trackId: top.id,
        createdAt: new Date(Date.UTC(2026, 7, 5 + i)),
      });
    }
    for (let i = 0; i < 2; i++) {
      await recordCompleted({
        userId: user.id,
        trackId: mid.id,
        createdAt: new Date(Date.UTC(2026, 7, 10 + i)),
      });
    }
    await recordCompleted({
      userId: user.id,
      trackId: low.id,
      createdAt: new Date(Date.UTC(2026, 7, 20)),
    });
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_started,
        userId: user.id,
        trackId: low.id,
        createdAt: new Date(Date.UTC(2026, 7, 21)),
      },
    });
    // Outside window
    await recordCompleted({
      userId: user.id,
      trackId: low.id,
      createdAt: new Date(Date.UTC(2026, 8, 1)),
    });

    const ranked = await rankPlayCompletedTracks({
      userId: user.id,
      windowStart,
      windowEndExclusive,
    });

    expect(ranked.map((row) => ({ trackId: row.trackId, listenCount: row.listenCount }))).toEqual([
      { trackId: top.id, listenCount: 3 },
      { trackId: mid.id, listenCount: 2 },
      { trackId: low.id, listenCount: 1 },
    ]);
  });

  test("caps at 30 tracks", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const { windowStart, windowEndExclusive } = yearMonthToUtcWindow("2026-08");
    const trackIds: string[] = [];
    for (let i = 0; i < 35; i++) {
      const track = await createTrack(`T${i}`);
      trackIds.push(track.id);
      // Distinct counts: track 0 has 35 completes … track 34 has 1
      // Batch create events for better performance
      const events = [];
      for (let j = 0; j < 35 - i; j++) {
        events.push({
          type: USAGE_EVENT_TYPES.play_completed,
          userId: user.id,
          trackId: track.id,
          createdAt: new Date(Date.UTC(2026, 7, 1, 0, j)),
        });
      }
      await prisma.usageEvent.createMany({ data: events });
    }

    const ranked = await rankPlayCompletedTracks({
      userId: user.id,
      windowStart,
      windowEndExclusive,
    });

    expect(ranked).toHaveLength(30);
    expect(ranked[0]?.trackId).toBe(trackIds[0]);
    expect(ranked[0]?.listenCount).toBe(35);
    expect(ranked[29]?.trackId).toBe(trackIds[29]);
    expect(ranked[29]?.listenCount).toBe(6);
  }, 15000);
});

describe("generateOnRepeatSnapshotForUser", () => {
  const yearMonth = "2026-08";
  const window = yearMonthToUtcWindow(yearMonth);

  beforeEach(async () => {
    await prisma.onRepeatSnapshotTrack.deleteMany();
    await prisma.onRepeatSnapshot.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("skips empty months (0 play_completed)", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const result = await generateOnRepeatSnapshotForUser({
      userId: user.id,
      ...window,
    });
    expect(result).toEqual({ status: "skipped_empty" });
    expect(await prisma.onRepeatSnapshot.count()).toBe(0);
  });

  test("creates thin months (1–29 tracks)", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const track = await createTrack("Only");
    await recordCompleted({
      userId: user.id,
      trackId: track.id,
      createdAt: new Date(Date.UTC(2026, 7, 12)),
    });

    const result = await generateOnRepeatSnapshotForUser({
      userId: user.id,
      ...window,
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");
    const snapshot = await prisma.onRepeatSnapshot.findUniqueOrThrow({
      where: { id: result.snapshotId },
      include: { tracks: { orderBy: { position: "asc" } } },
    });
    expect(snapshot.yearMonth).toBe(yearMonth);
    expect(snapshot.tracks).toHaveLength(1);
    expect(snapshot.tracks[0]).toMatchObject({
      trackId: track.id,
      position: 0,
      listenCount: 1,
    });
  });

  test("is idempotent per (userId, yearMonth)", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const track = await createTrack("Once");
    await recordCompleted({
      userId: user.id,
      trackId: track.id,
      createdAt: new Date(Date.UTC(2026, 7, 3)),
    });

    const first = await generateOnRepeatSnapshotForUser({
      userId: user.id,
      ...window,
    });
    const second = await generateOnRepeatSnapshotForUser({
      userId: user.id,
      ...window,
    });

    expect(first.status).toBe("created");
    expect(second).toEqual({
      status: "already_exists",
      snapshotId: (first as { snapshotId: string }).snapshotId,
    });
    expect(await prisma.onRepeatSnapshot.count()).toBe(1);
  });
});

describe("generateOnRepeatSnapshotsForMonth", () => {
  beforeEach(async () => {
    await prisma.onRepeatSnapshotTrack.deleteMany();
    await prisma.onRepeatSnapshot.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("generates for users with completes and skips empty users", async () => {
    const active = await prisma.user.create({ data: createUser() });
    const idle = await prisma.user.create({ data: createUser() });
    const track = await createTrack("Hit");
    await recordCompleted({
      userId: active.id,
      trackId: track.id,
      createdAt: new Date(Date.UTC(2026, 7, 8)),
    });
    // idle has play_started only — should not get a snapshot
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_started,
        userId: idle.id,
        trackId: track.id,
        createdAt: new Date(Date.UTC(2026, 7, 8)),
      },
    });

    const summary = await generateOnRepeatSnapshotsForMonth({
      asOf: new Date(Date.UTC(2026, 8, 1)),
    });

    expect(summary).toMatchObject({
      yearMonth: "2026-08",
      created: 1,
      skippedEmpty: 0,
      alreadyExists: 0,
    });
    const snapshots = await prisma.onRepeatSnapshot.findMany();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.userId).toBe(active.id);
  });
});
