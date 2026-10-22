import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  countDayStreak,
  getUtcWeekRange,
  getWeeklyWrap,
  summarizeWeeklyWrap,
} from "./weekly-wrap.server.ts";

describe("getUtcWeekRange", () => {
  test("returns Monday 00:00 UTC through next Monday for a mid-week instant", () => {
    // Wednesday 2026-09-23 15:30 UTC
    const { start, end } = getUtcWeekRange(new Date("2026-09-23T15:30:00.000Z"));
    expect(start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("treats Monday as the start of the week", () => {
    const { start, end } = getUtcWeekRange(new Date("2026-09-21T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("includes Sunday in the week that began the prior Monday", () => {
    const { start, end } = getUtcWeekRange(new Date("2026-09-27T23:59:59.999Z"));
    expect(start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("rolls to the next Monday–Sunday week after Sunday", () => {
    const { start, end } = getUtcWeekRange(new Date("2026-09-28T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("countDayStreak", () => {
  test("returns 0 when today has no activity", () => {
    const today = new Date("2026-09-23T12:00:00.000Z");
    expect(countDayStreak(new Set(["2026-09-22"]), today)).toBe(0);
  });

  test("counts consecutive UTC days ending today", () => {
    const today = new Date("2026-09-23T12:00:00.000Z");
    expect(countDayStreak(new Set(["2026-09-21", "2026-09-22", "2026-09-23"]), today)).toBe(3);
  });

  test("stops at the first gap", () => {
    const today = new Date("2026-09-23T12:00:00.000Z");
    expect(countDayStreak(new Set(["2026-09-20", "2026-09-22", "2026-09-23"]), today)).toBe(2);
  });
});

describe("summarizeWeeklyWrap", () => {
  const now = new Date("2026-09-23T15:00:00.000Z");
  const weekStart = new Date("2026-09-21T00:00:00.000Z");
  const weekEnd = new Date("2026-09-28T00:00:00.000Z");

  test("returns null when there are zero finishes in the week", () => {
    expect(
      summarizeWeeklyWrap({
        weekEvents: [],
        activeDayKeys: new Set(["2026-09-20"]),
        now,
        weekStart,
        weekEnd,
      }),
    ).toBeNull();
  });

  test("counts finishes and unique tracks; omits streak when ≤ 1", () => {
    const summary = summarizeWeeklyWrap({
      weekEvents: [
        { trackId: "t1", createdAt: new Date("2026-09-23T10:00:00.000Z") },
        { trackId: "t1", createdAt: new Date("2026-09-23T11:00:00.000Z") },
        { trackId: "t2", createdAt: new Date("2026-09-23T12:00:00.000Z") },
      ],
      activeDayKeys: new Set(["2026-09-23"]),
      now,
      weekStart,
      weekEnd,
    });

    expect(summary).toEqual({
      finishes: 3,
      uniqueTracks: 2,
      dayStreak: null,
    });
  });

  test("includes day streak only when greater than 1", () => {
    const summary = summarizeWeeklyWrap({
      weekEvents: [
        { trackId: "t1", createdAt: new Date("2026-09-22T10:00:00.000Z") },
        { trackId: "t2", createdAt: new Date("2026-09-23T10:00:00.000Z") },
      ],
      activeDayKeys: new Set(["2026-09-22", "2026-09-23"]),
      now,
      weekStart,
      weekEnd,
    });

    expect(summary).toEqual({
      finishes: 2,
      uniqueTracks: 2,
      dayStreak: 2,
    });
  });

  test("ignores null trackIds when counting unique tracks", () => {
    const summary = summarizeWeeklyWrap({
      weekEvents: [
        { trackId: null, createdAt: new Date("2026-09-23T10:00:00.000Z") },
        { trackId: "t1", createdAt: new Date("2026-09-23T11:00:00.000Z") },
      ],
      activeDayKeys: new Set(["2026-09-23"]),
      now,
      weekStart,
      weekEnd,
    });

    expect(summary).toMatchObject({ finishes: 2, uniqueTracks: 1, dayStreak: null });
  });
});

describe("getWeeklyWrap", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.dailyUsageStat.deleteMany();
    await prisma.dailyActiveUser.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedUser() {
    return prisma.user.create({ data: createUser() });
  }

  async function seedCompleted(
    userId: string,
    createdAt: Date,
    trackId: string | null = "track-a",
  ) {
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_completed,
        userId,
        trackId,
        createdAt,
      },
    });
  }

  test("hides when the current UTC week has no play_completed events", async () => {
    const user = await seedUser();
    // Prior week only
    await seedCompleted(user.id, new Date("2026-09-20T12:00:00.000Z"));

    expect(await getWeeklyWrap(user.id, new Date("2026-09-23T12:00:00.000Z"))).toBeNull();
  });

  test("aggregates finishes and unique tracks for Mon–Sun UTC week only", async () => {
    const user = await seedUser();
    const now = new Date("2026-09-23T12:00:00.000Z");

    // Outside week (prior Saturday) — gap on Sun so streak does not extend
    await seedCompleted(user.id, new Date("2026-09-19T12:00:00.000Z"), "old");
    // In week
    await seedCompleted(user.id, new Date("2026-09-21T00:00:00.000Z"), "t1");
    await seedCompleted(user.id, new Date("2026-09-22T08:00:00.000Z"), "t1");
    await seedCompleted(user.id, new Date("2026-09-23T08:00:00.000Z"), "t2");
    // play_started must not count
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_started,
        userId: user.id,
        trackId: "t3",
        createdAt: new Date("2026-09-23T09:00:00.000Z"),
      },
    });
    // Next Monday out of range
    await seedCompleted(user.id, new Date("2026-09-28T00:00:00.000Z"), "t4");

    const wrap = await getWeeklyWrap(user.id, now);
    expect(wrap).toEqual({
      finishes: 3,
      uniqueTracks: 2,
      dayStreak: 3, // Mon–Wed consecutive ending today
    });
  });

  test("exposes day streak only when greater than 1", async () => {
    const user = await seedUser();
    const now = new Date("2026-09-23T12:00:00.000Z");

    await seedCompleted(user.id, new Date("2026-09-22T10:00:00.000Z"), "t1");
    await seedCompleted(user.id, new Date("2026-09-23T10:00:00.000Z"), "t2");

    expect(await getWeeklyWrap(user.id, now)).toEqual({
      finishes: 2,
      uniqueTracks: 2,
      dayStreak: 2,
    });
  });

  test("streak of 1 is omitted even when the week has finishes", async () => {
    const user = await seedUser();
    const now = new Date("2026-09-23T12:00:00.000Z");

    await seedCompleted(user.id, new Date("2026-09-21T10:00:00.000Z"), "t1");
    await seedCompleted(user.id, new Date("2026-09-23T10:00:00.000Z"), "t1");

    expect(await getWeeklyWrap(user.id, now)).toEqual({
      finishes: 2,
      uniqueTracks: 1,
      dayStreak: null,
    });
  });

  test("ignores other users' play_completed events", async () => {
    const user = await seedUser();
    const other = await seedUser();
    const now = new Date("2026-09-23T12:00:00.000Z");

    await seedCompleted(other.id, new Date("2026-09-23T10:00:00.000Z"), "t1");
    await seedCompleted(user.id, new Date("2026-09-23T11:00:00.000Z"), "t2");

    expect(await getWeeklyWrap(user.id, now)).toEqual({
      finishes: 1,
      uniqueTracks: 1,
      dayStreak: null,
    });
  });
});
