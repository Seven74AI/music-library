import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { HEAVY_ROTATION_HOME_CAP } from "./heavy-rotation.ts";
import { getHeavyRotationTracks } from "./heavy-rotation.server.ts";

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

describe("getHeavyRotationTracks", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.trackAudioFile.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("returns ranked tracks with counts for the month window", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const hot = await createTrack("Hot");
    const warm = await createTrack("Warm");
    const now = new Date("2026-09-20T12:00:00.000Z");

    await seedCompleted(user.id, hot.id, new Date("2026-09-05T12:00:00.000Z"), 4);
    await seedCompleted(user.id, warm.id, new Date("2026-09-08T12:00:00.000Z"), 2);
    // prior month ignored
    await seedCompleted(user.id, warm.id, new Date("2026-08-01T12:00:00.000Z"), 10);

    const tracks = await getHeavyRotationTracks({
      userId: user.id,
      window: "month",
      now,
    });

    expect(tracks.map((t) => t.track.id)).toEqual([hot.id, warm.id]);
    expect(tracks[0]?.completedCount).toBe(4);
    expect(tracks[1]?.completedCount).toBe(2);
    expect(tracks[0]?.track.title).toBe("Hot");
  });

  test("skips dangling track ids", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const alive = await createTrack("Alive");
    await seedCompleted(user.id, alive.id, new Date("2026-09-05T12:00:00.000Z"), 1);
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_completed,
        userId: user.id,
        trackId: "deleted-track-id",
        createdAt: new Date("2026-09-05T12:00:00.000Z"),
      },
    });

    const tracks = await getHeavyRotationTracks({
      userId: user.id,
      window: "ever",
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.track.id).toBe(alive.id);
  });

  test("returns empty array when there are no qualifies (home strip should hide)", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const tracks = await getHeavyRotationTracks({
      userId: user.id,
      window: "ever",
    });
    expect(tracks).toEqual([]);
  });

  test("respects the home strip limit cap", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const now = new Date("2026-09-15T00:00:00.000Z");
    const service = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
    });

    const trackIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const artist = await prisma.artist.create({
        data: { name: `Artist ${i}`, normalizedName: `artist ${i}` },
      });
      const track = await prisma.track.create({
        data: {
          title: `T${i}`,
          externalId: `ext-cap-${i}`,
          serviceId: service.id,
          artistId: artist.id,
        },
      });
      trackIds.push(track.id);
    }

    await prisma.usageEvent.createMany({
      data: trackIds.flatMap((trackId, i) =>
        Array.from({ length: i + 1 }, () => ({
          type: USAGE_EVENT_TYPES.play_completed,
          userId: user.id,
          trackId,
          createdAt: new Date("2026-09-10T12:00:00.000Z"),
        })),
      ),
    });

    const tracks = await getHeavyRotationTracks({
      userId: user.id,
      window: "month",
      now,
      limit: 5,
    });

    expect(HEAVY_ROTATION_HOME_CAP).toBe(50);
    expect(tracks).toHaveLength(5);
    expect(tracks[0]?.completedCount).toBe(8);
    expect(tracks[tracks.length - 1]?.completedCount).toBe(4);
  });
});
