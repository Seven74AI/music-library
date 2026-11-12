import { beforeEach, describe, expect, test, vi } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser, createTrack, resetUsageAnalyticsTables } from "#tests/db-utils.ts";
import { getHeavyRotationTracks } from "./heavy-rotation.server.ts";
import * as playCompletedCounts from "./play-completed-counts.server.ts";

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
    await resetUsageAnalyticsTables();
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

    expect(tracks).toHaveLength(5);
    expect(tracks[0]?.completedCount).toBe(8);
    expect(tracks[tracks.length - 1]?.completedCount).toBe(4);
  });

  test("omits track deleted between existence check and detail fetch", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const vanishing = await createTrack("Vanishing");
    const stable = await createTrack("Stable");
    await seedCompleted(user.id, vanishing.id, new Date("2026-09-05T12:00:00.000Z"), 3);
    await seedCompleted(user.id, stable.id, new Date("2026-09-05T12:00:00.000Z"), 1);

    const originalFindMany = prisma.track.findMany.bind(prisma.track);
    vi.spyOn(prisma.track, "findMany").mockImplementation((async (args) => {
      const select = (args as { select?: Record<string, unknown> }).select;
      if (select && "title" in select) {
        const ids = (args as { where?: { id?: { in?: string[] } } }).where?.id?.in ?? [];
        const survivingIds = ids.filter((id) => id !== vanishing.id);
        if (survivingIds.length === 0) return [];
        return originalFindMany({
          where: { id: { in: survivingIds } },
          select,
        } as Parameters<typeof prisma.track.findMany>[0]);
      }
      return originalFindMany(args);
    }) as typeof prisma.track.findMany);

    const tracks = await getHeavyRotationTracks({
      userId: user.id,
      window: "ever",
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.track.id).toBe(stable.id);

    vi.restoreAllMocks();
  });

  test("chunks large track id IN lookups to stay under SQLite bind limits", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const candidateIds = Array.from({ length: 1200 }, (_, index) => `track-${index}`);
    const counts = new Map(candidateIds.map((id, index) => [id, 1200 - index]));
    vi.spyOn(playCompletedCounts, "getPlayCompletedCountsByTrack").mockResolvedValue(counts);
    const findManySpy = vi.spyOn(prisma.track, "findMany").mockImplementation((async (args) => {
      const ids = (args as { where?: { id?: { in?: string[] } } }).where?.id?.in ?? [];
      return ids.map((id) => ({ id }));
    }) as typeof prisma.track.findMany);

    await getHeavyRotationTracks({ userId: user.id, window: "ever", limit: 5 });

    const chunkSizes = findManySpy.mock.calls
      .map((call) => (call[0] as { where?: { id?: { in?: string[] } } }).where?.id?.in?.length ?? 0)
      .filter((size) => size > 0);
    expect(chunkSizes.every((size) => size <= 500)).toBe(true);
    expect(chunkSizes.filter((size) => size > 100)).toEqual([500, 500, 200]);

    findManySpy.mockRestore();
    vi.restoreAllMocks();
  });
});
