import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  USAGE_EVENT_TYPES,
  USAGE_METRICS,
  getUtcDayStart,
  recordUsageEvent,
} from "./record-usage.server.ts";

describe("recordUsageEvent", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.dailyUsageStat.deleteMany();
    await prisma.dailyActiveUser.deleteMany();
    await prisma.user.deleteMany();
  });

  test("writes a usage event and increments the daily metric", async () => {
    const user = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({
      type: USAGE_EVENT_TYPES.signup,
      userId: user.id,
    });

    const events = await prisma.usageEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "signup",
      userId: user.id,
      trackId: null,
    });

    const day = getUtcDayStart();
    const stat = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.signups } },
    });
    expect(stat?.value).toBe(1);
  });

  test("increments daily metric on repeated events", async () => {
    const user = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({ type: USAGE_EVENT_TYPES.library_add, userId: user.id });
    await recordUsageEvent({
      type: USAGE_EVENT_TYPES.library_add,
      userId: user.id,
      trackId: "track-1",
    });

    const day = getUtcDayStart();
    const stat = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.library_adds } },
    });
    expect(stat?.value).toBe(2);
    expect(await prisma.usageEvent.count()).toBe(2);
  });

  test("counts DAU once per user per UTC day on login", async () => {
    const user = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: user.id });
    await recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: user.id });
    await recordUsageEvent({
      type: USAGE_EVENT_TYPES.play_started,
      userId: user.id,
      trackId: "t1",
    });

    const day = getUtcDayStart();
    const dau = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.dau } },
    });
    expect(dau?.value).toBe(1);

    const loginStat = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.logins } },
    });
    expect(loginStat?.value).toBe(2);

    const playStat = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.plays_started } },
    });
    expect(playStat?.value).toBe(1);
  });

  test("counts a signup toward DAU on the day the account is created", async () => {
    const user = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({ type: USAGE_EVENT_TYPES.signup, userId: user.id });

    const day = getUtcDayStart();
    const dau = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.dau } },
    });
    expect(dau?.value).toBe(1);
  });

  test("does not double-count DAU when a signup is followed by a login", async () => {
    const user = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({ type: USAGE_EVENT_TYPES.signup, userId: user.id });
    await recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: user.id });

    const day = getUtcDayStart();
    const dau = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.dau } },
    });
    expect(dau?.value).toBe(1);
    expect(await prisma.dailyActiveUser.count()).toBe(1);
  });

  test("keeps the DAU counter and dedupe rows consistent across repeat events", async () => {
    const userA = await prisma.user.create({ data: createUser() });
    const userB = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: userA.id });
    await recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: userA.id });
    await recordUsageEvent({ type: USAGE_EVENT_TYPES.play_started, userId: userB.id });

    const day = getUtcDayStart();
    const dau = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.dau } },
    });
    expect(dau?.value).toBe(await prisma.dailyActiveUser.count());
    expect(dau?.value).toBe(2);
  });

  test("propagates write failures instead of silently dropping them", async () => {
    await expect(
      recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: "no-such-user" }),
    ).rejects.toThrow();
  });

  test("counts two users as two DAU", async () => {
    const userA = await prisma.user.create({ data: createUser() });
    const userB = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({ type: USAGE_EVENT_TYPES.login, userId: userA.id });
    await recordUsageEvent({ type: USAGE_EVENT_TYPES.play_started, userId: userB.id });

    const day = getUtcDayStart();
    const dau = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.dau } },
    });
    expect(dau?.value).toBe(2);
  });

  test("stores optional meta JSON", async () => {
    const user = await prisma.user.create({ data: createUser() });

    await recordUsageEvent({
      type: USAGE_EVENT_TYPES.play_completed,
      userId: user.id,
      trackId: "track-9",
      meta: { reason: "ended" },
    });

    const event = await prisma.usageEvent.findFirstOrThrow();
    expect(event.meta).toBe(JSON.stringify({ reason: "ended" }));
  });
});
