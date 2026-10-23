import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  getPlayCompletedCountsByTrack,
  type HeavyRotationWindow,
} from "./play-completed-counts.server.ts";

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

async function seedCompleted(userId: string, trackId: string, createdAt: Date, count = 1) {
  for (let i = 0; i < count; i++) {
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_completed,
        userId,
        trackId,
        createdAt,
      },
    });
  }
}

describe("getPlayCompletedCountsByTrack", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("counts lifetime play_completed events per track for ever window", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const trackA = await createTrack("A");
    const trackB = await createTrack("B");

    await seedCompleted(user.id, trackA.id, new Date("2025-01-15T12:00:00.000Z"), 3);
    await seedCompleted(user.id, trackB.id, new Date("2026-06-01T12:00:00.000Z"), 1);
    // play_started must not count
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_started,
        userId: user.id,
        trackId: trackA.id,
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
      },
    });

    const counts = await getPlayCompletedCountsByTrack({
      userId: user.id,
      window: "ever" satisfies HeavyRotationWindow,
    });

    expect(counts.get(trackA.id)).toBe(3);
    expect(counts.get(trackB.id)).toBe(1);
    expect(counts.size).toBe(2);
  });

  test("month window only includes current UTC calendar month", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const trackA = await createTrack("A");
    const trackB = await createTrack("B");
    const now = new Date("2026-09-23T15:00:00.000Z");

    await seedCompleted(user.id, trackA.id, new Date("2026-09-01T00:00:00.000Z"), 2);
    await seedCompleted(user.id, trackA.id, new Date("2026-09-23T23:59:59.000Z"), 1);
    // previous month — excluded
    await seedCompleted(user.id, trackA.id, new Date("2026-08-31T23:59:59.000Z"), 5);
    // next month — excluded
    await seedCompleted(user.id, trackB.id, new Date("2026-10-01T00:00:00.000Z"), 4);
    await seedCompleted(user.id, trackB.id, new Date("2026-09-10T12:00:00.000Z"), 1);

    const counts = await getPlayCompletedCountsByTrack({
      userId: user.id,
      window: "month",
      now,
    });

    expect(counts.get(trackA.id)).toBe(3);
    expect(counts.get(trackB.id)).toBe(1);
    expect(counts.size).toBe(2);
  });

  test("ignores null trackId and other users", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const other = await prisma.user.create({ data: createUser() });
    const track = await createTrack("Solo");

    await seedCompleted(user.id, track.id, new Date("2026-09-10T12:00:00.000Z"), 2);
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_completed,
        userId: user.id,
        trackId: null,
        createdAt: new Date("2026-09-10T12:00:00.000Z"),
      },
    });
    await seedCompleted(other.id, track.id, new Date("2026-09-10T12:00:00.000Z"), 9);

    const counts = await getPlayCompletedCountsByTrack({
      userId: user.id,
      window: "month",
      now: new Date("2026-09-15T00:00:00.000Z"),
    });

    expect(counts.get(track.id)).toBe(2);
    expect(counts.size).toBe(1);
  });

  test("returns empty map when there are no completes", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const counts = await getPlayCompletedCountsByTrack({
      userId: user.id,
      window: "ever",
    });
    expect(counts.size).toBe(0);
  });
});
