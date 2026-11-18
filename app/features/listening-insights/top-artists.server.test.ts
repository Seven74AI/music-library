import { beforeEach, describe, expect, test, vi } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  createTrack,
  createTrackForArtist,
  createUser,
  resetUsageAnalyticsTables,
} from "#tests/db-utils.ts";
import { getTopArtists } from "./top-artists.server.ts";

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

async function makeArtist(name: string) {
  return prisma.artist.create({ data: { name, normalizedName: name.toLowerCase() } });
}

describe("getTopArtists", () => {
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

  test("aggregates plays across tracks of one artist and ranks by count", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const a = await makeArtist("Alpha");
    const b = await makeArtist("Beta");
    const a1 = await createTrackForArtist(a.id, "A1");
    const a2 = await createTrackForArtist(a.id, "A2");
    const b1 = await createTrackForArtist(b.id, "B1");
    await seed(user.id, a1.id, 2);
    await seed(user.id, a2.id, 2);
    await seed(user.id, b1.id, 3);

    const result = await getTopArtists({ userId: user.id });
    expect(result.map((r) => r.artist.id)).toEqual([a.id, b.id]);
    expect(result.map((r) => r.count)).toEqual([4, 3]);
    expect(result[0]?.artist.name).toBe("Alpha");
  });

  test("ignores play_started, dangling and null trackIds", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const t = await createTrack("T");
    await seed(user.id, t.id, 1);
    await seed(user.id, t.id, 5, undefined, USAGE_EVENT_TYPES.play_started);
    await seed(user.id, "gone-track", 4);
    await seed(user.id, null, 4);

    const result = await getTopArtists({ userId: user.id });
    expect(result).toHaveLength(1);
    expect(result[0]?.count).toBe(1);
  });

  test("breaks ties by latest play then artist id", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const older = await makeArtist("Older");
    const newer = await makeArtist("Newer");
    const tOld = await createTrackForArtist(older.id, "o");
    const tNew = await createTrackForArtist(newer.id, "n");
    await seed(user.id, tOld.id, 2, new Date("2026-01-01T00:00:00.000Z"));
    await seed(user.id, tNew.id, 2, new Date("2026-02-01T00:00:00.000Z"));

    const result = await getTopArtists({ userId: user.id });
    expect(result.map((r) => r.artist.id)).toEqual([newer.id, older.id]);

    // identical latest timestamp → artist.id asc
    const x = await makeArtist("X");
    const y = await makeArtist("Y");
    const tx = await createTrackForArtist(x.id, "x");
    const ty = await createTrackForArtist(y.id, "y");
    const same = new Date("2026-03-01T00:00:00.000Z");
    await seed(user.id, tx.id, 9, same);
    await seed(user.id, ty.id, 9, same);
    const top = await getTopArtists({ userId: user.id, limit: 2 });
    expect(top.map((r) => r.artist.id)).toEqual([x.id, y.id].sort());
  });

  test("caps at 10 by default and honors limit", async () => {
    const user = await prisma.user.create({ data: createUser() });
    for (let i = 0; i < 12; i++) {
      const artist = await makeArtist(`Artist ${i}`);
      const track = await createTrackForArtist(artist.id, `T${i}`);
      await seed(user.id, track.id, i + 1);
    }
    expect(await getTopArtists({ userId: user.id })).toHaveLength(10);
    const three = await getTopArtists({ userId: user.id, limit: 3 });
    expect(three.map((r) => r.count)).toEqual([12, 11, 10]);
  });

  test("isolates users and returns [] when there is no data", async () => {
    const u1 = await prisma.user.create({ data: createUser() });
    const u2 = await prisma.user.create({ data: createUser() });
    const t = await createTrack("T");
    await seed(u2.id, t.id, 3);
    expect(await getTopArtists({ userId: u1.id })).toEqual([]);
  });

  test("chunks artist detail lookups to stay under SQLite bind limits", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const t = await createTrack("T");
    await seed(user.id, t.id, 1);
    // Fake a >500 candidate result from the aggregate query.
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      artistId: `artist-${i}`,
      count: 1200 - i,
      latest: new Date("2026-09-05T12:00:00.000Z").getTime(),
    }));
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(rows as never);
    const findManySpy = vi.spyOn(prisma.artist, "findMany").mockImplementation((async (args) => {
      const ids = (args as { where?: { id?: { in?: string[] } } }).where?.id?.in ?? [];
      return ids.map((id) => ({ id, name: id }));
    }) as typeof prisma.artist.findMany);

    await getTopArtists({ userId: user.id, limit: 1200 });

    const sizes = findManySpy.mock.calls
      .map((c) => (c[0] as { where?: { id?: { in?: string[] } } }).where?.id?.in?.length ?? 0)
      .filter((s) => s > 0);
    expect(sizes).toEqual([500, 500, 200]);
  });
});
