import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { RECENTLY_PLAYED_LIMIT, getRecentlyPlayedTracks } from "./recently-played.server.ts";

async function createTestUser() {
  return prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });
}

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

async function createTrack(title: string) {
  const service = await ensureLocalService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.track.create({
    data: {
      title: `${title} ${suffix}`,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: {
          name: `Artist ${suffix}`,
          normalizedName: `artist ${suffix}`,
        },
      },
    },
  });
}

async function createPlayCompleted({
  userId,
  trackId,
  createdAt,
  playId,
}: {
  userId: string;
  trackId: string | null;
  createdAt: Date;
  playId?: string;
}) {
  return prisma.usageEvent.create({
    data: {
      type: USAGE_EVENT_TYPES.play_completed,
      userId,
      trackId,
      playId: playId ?? `play-${Math.random().toString(36).slice(2, 10)}`,
      createdAt,
    },
  });
}

async function createPlayStarted({
  userId,
  trackId,
  createdAt,
}: {
  userId: string;
  trackId: string;
  createdAt: Date;
}) {
  return prisma.usageEvent.create({
    data: {
      type: USAGE_EVENT_TYPES.play_started,
      userId,
      trackId,
      playId: `started-${Math.random().toString(36).slice(2, 10)}`,
      createdAt,
    },
  });
}

const T0 = new Date("2026-09-23T12:00:00.000Z");

function at(seconds: number) {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("getRecentlyPlayedTracks", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.dailyUsageStat.deleteMany();
    await prisma.dailyActiveUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });
  });

  test("returns empty when the user has no play_completed events", async () => {
    const user = await createTestUser();
    const track = await createTrack("Never Finished");
    await createPlayStarted({ userId: user.id, trackId: track.id, createdAt: at(0) });

    const result = await getRecentlyPlayedTracks({ userId: user.id });

    expect(result).toEqual([]);
  });

  test("orders by most recent play_completed and collapses repeats to distinct tracks", async () => {
    const user = await createTestUser();
    const a = await createTrack("Alpha");
    const b = await createTrack("Beta");
    const c = await createTrack("Gamma");

    // Completions (newest last in list below — timestamps decide order):
    // A@0, B@10, A@20 (repeat), C@30 → distinct order: C, A, B
    await createPlayCompleted({ userId: user.id, trackId: a.id, createdAt: at(0) });
    await createPlayCompleted({ userId: user.id, trackId: b.id, createdAt: at(10) });
    await createPlayCompleted({ userId: user.id, trackId: a.id, createdAt: at(20) });
    await createPlayCompleted({ userId: user.id, trackId: c.id, createdAt: at(30) });

    const result = await getRecentlyPlayedTracks({ userId: user.id });

    expect(result.map((item) => item.track.id)).toEqual([c.id, a.id, b.id]);
    expect(result.map((item) => item.playedAt.toISOString())).toEqual([
      at(30).toISOString(),
      at(20).toISOString(),
      at(10).toISOString(),
    ]);
  });

  test("ignores play_started and other users' completions", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    const mine = await createTrack("Mine");
    const theirs = await createTrack("Theirs");
    const startedOnly = await createTrack("Started Only");

    await createPlayCompleted({ userId: user.id, trackId: mine.id, createdAt: at(10) });
    await createPlayCompleted({ userId: other.id, trackId: theirs.id, createdAt: at(20) });
    await createPlayStarted({ userId: user.id, trackId: startedOnly.id, createdAt: at(30) });

    const result = await getRecentlyPlayedTracks({ userId: user.id });

    expect(result.map((item) => item.track.id)).toEqual([mine.id]);
  });

  test("skips dangling track IDs", async () => {
    const user = await createTestUser();
    const alive = await createTrack("Alive");
    const doomed = await createTrack("Doomed");

    await createPlayCompleted({ userId: user.id, trackId: doomed.id, createdAt: at(20) });
    await createPlayCompleted({ userId: user.id, trackId: alive.id, createdAt: at(10) });
    await prisma.track.delete({ where: { id: doomed.id } });

    const result = await getRecentlyPlayedTracks({ userId: user.id });

    expect(result.map((item) => item.track.id)).toEqual([alive.id]);
  });

  test(`caps at ${RECENTLY_PLAYED_LIMIT} distinct tracks`, async () => {
    const user = await createTestUser();
    const tracks = [];
    for (let i = 0; i < RECENTLY_PLAYED_LIMIT + 5; i++) {
      tracks.push(await createTrack(`Track ${i}`));
    }

    for (let i = 0; i < tracks.length; i++) {
      await createPlayCompleted({
        userId: user.id,
        trackId: tracks[i]!.id,
        createdAt: at(i),
      });
    }

    const result = await getRecentlyPlayedTracks({ userId: user.id });

    expect(result).toHaveLength(RECENTLY_PLAYED_LIMIT);
    // Newest completions first: last tracks in creation order
    expect(result[0]!.track.id).toBe(tracks[tracks.length - 1]!.id);
    expect(result[RECENTLY_PLAYED_LIMIT - 1]!.track.id).toBe(
      tracks[tracks.length - RECENTLY_PLAYED_LIMIT]!.id,
    );
  });

  test("includes track fields needed for home playable tiles", async () => {
    const user = await createTestUser();
    const track = await createTrack("Playable");
    await prisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/playable.mp3",
        format: "mp3",
      },
    });
    await createPlayCompleted({ userId: user.id, trackId: track.id, createdAt: at(0) });

    const [item] = await getRecentlyPlayedTracks({ userId: user.id });

    expect(item).toMatchObject({
      track: {
        id: track.id,
        title: expect.stringContaining("Playable"),
        artist: { name: expect.any(String) },
        audioFiles: [{ objectKey: "audio/playable.mp3", format: "mp3" }],
      },
    });
  });
});
