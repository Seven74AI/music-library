import { beforeEach, describe, expect, test, vi } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  createTrack,
  createTrackForArtist,
  createUser,
  resetUsageAnalyticsTables,
} from "#tests/db-utils.ts";
import { getProfileStats, getTopTracks } from "./profile-stats.server.ts";

async function seed(
  userId: string,
  trackId: string | null,
  count = 1,
  createdAt = new Date("2026-09-05T12:00:00.000Z"),
  type: string = USAGE_EVENT_TYPES.play_completed,
) {
  for (let i = 0; i < count; i++) {
    await prisma.usageEvent.create({ data: { type, userId, trackId, createdAt } });
  }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetUsageAnalyticsTables();
  await prisma.trackAudioFile.deleteMany();
  await prisma.userTrack.deleteMany();
  await prisma.track.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

describe("getProfileStats", () => {
  test("returns zeros for a user with no data", async () => {
    const user = await prisma.user.create({ data: createUser() });
    expect(await getProfileStats({ userId: user.id })).toEqual({
      plays: 0,
      librarySize: 0,
      listeningTimeSeconds: 0,
    });
  });

  test("counts completed plays on existing tracks and sums durations, skipping nulls", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const artist = await prisma.artist.create({ data: { name: "A", normalizedName: "a" } });
    const t1 = await createTrackForArtist(artist.id, "T1", { duration: 200 });
    const t2 = await createTrackForArtist(artist.id, "T2", { duration: null });
    await seed(user.id, t1.id, 3);
    await seed(user.id, t2.id, 2);
    await seed(user.id, t1.id, 7, undefined, USAGE_EVENT_TYPES.play_started);
    await seed(user.id, "dangling", 4);
    await seed(user.id, null, 4);

    const stats = await getProfileStats({ userId: user.id });
    expect(stats.plays).toBe(5);
    expect(stats.listeningTimeSeconds).toBe(600);
  });

  test("library size counts only active, non-deleted UserTracks", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const t1 = await createTrack("1");
    const t2 = await createTrack("2");
    const t3 = await createTrack("3");
    await prisma.userTrack.create({ data: { userId: user.id, trackId: t1.id } });
    await prisma.userTrack.create({
      data: { userId: user.id, trackId: t2.id, isActive: false },
    });
    await prisma.userTrack.create({
      data: { userId: user.id, trackId: t3.id, deletedAt: new Date() },
    });
    expect((await getProfileStats({ userId: user.id })).librarySize).toBe(1);
  });

  test("isolates users", async () => {
    const u1 = await prisma.user.create({ data: createUser() });
    const u2 = await prisma.user.create({ data: createUser() });
    const t = await createTrack("T");
    await seed(u2.id, t.id, 3);
    expect((await getProfileStats({ userId: u1.id })).plays).toBe(0);
  });
});

describe("getTopTracks", () => {
  test("ranks by count with static rows and ignores play_started/dangling", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const hot = await createTrack("Hot");
    const warm = await createTrack("Warm");
    await seed(user.id, hot.id, 4);
    await seed(user.id, warm.id, 2);
    await seed(user.id, warm.id, 9, undefined, USAGE_EVENT_TYPES.play_started);
    await seed(user.id, "gone", 8);

    const rows = await getTopTracks({ userId: user.id });
    expect(rows.map((r) => r.track.id)).toEqual([hot.id, warm.id]);
    expect(rows.map((r) => r.count)).toEqual([4, 2]);
    expect(rows[0]?.track.title).toBe("Hot");
    expect(rows[0]?.track.artist.name).toBeTruthy();
    expect(rows[0]?.track).not.toHaveProperty("audioFiles");
    expect(rows[0]?.track).not.toHaveProperty("serviceUrl");
  });

  test("tie-breaks by latest play then track id", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const older = await createTrack("Older");
    const newer = await createTrack("Newer");
    await seed(user.id, older.id, 2, new Date("2026-01-01T00:00:00.000Z"));
    await seed(user.id, newer.id, 2, new Date("2026-02-01T00:00:00.000Z"));
    expect((await getTopTracks({ userId: user.id })).map((r) => r.track.id)).toEqual([
      newer.id,
      older.id,
    ]);

    const x = await createTrack("X");
    const y = await createTrack("Y");
    const same = new Date("2026-03-01T00:00:00.000Z");
    await seed(user.id, x.id, 9, same);
    await seed(user.id, y.id, 9, same);
    const top = await getTopTracks({ userId: user.id, limit: 2 });
    expect(top.map((r) => r.track.id)).toEqual([x.id, y.id].sort());
  });

  test("caps at 10 and isolates users; empty → []", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const other = await prisma.user.create({ data: createUser() });
    for (let i = 0; i < 12; i++) {
      const t = await createTrack(`T${i}`);
      await seed(user.id, t.id, i + 1);
    }
    expect(await getTopTracks({ userId: user.id })).toHaveLength(10);
    expect(await getTopTracks({ userId: other.id })).toEqual([]);
  });

  test("chunks track detail lookups to stay under SQLite bind limits", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const t = await createTrack("T");
    await seed(user.id, t.id, 1);
    // Fake a >500 candidate result from the aggregate query.
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      trackId: `track-${i}`,
      count: 1200 - i,
    }));
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(rows as never);
    const findManySpy = vi.spyOn(prisma.track, "findMany").mockImplementation((async (
      args: unknown,
    ) => {
      const ids = (args as { where?: { id?: { in?: string[] } } }).where?.id?.in ?? [];
      return ids.map((id) => ({ id, title: id, artist: { id: "a", name: "a" } }));
    }) as unknown as typeof prisma.track.findMany);

    await getTopTracks({ userId: user.id, limit: 1200 });

    const sizes = findManySpy.mock.calls
      .map((c) => (c[0] as { where?: { id?: { in?: string[] } } }).where?.id?.in?.length ?? 0)
      .filter((s) => s > 0);
    expect(sizes).toEqual([500, 500, 200]);
  });
});
