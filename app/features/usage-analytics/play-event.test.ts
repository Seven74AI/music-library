import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { action } from "#app/routes/resources+/play-event.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  consumePlayEventBudget,
  PLAY_EVENT_MAX_PER_WINDOW,
  resetPlayEventBudgets,
} from "./play-event-rate-limit.server.ts";
import { USAGE_EVENT_TYPES, USAGE_METRICS, getUtcDayStart } from "./record-usage.server.ts";

async function createUserCookie() {
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expirationDate: getSessionExpirationDate(),
    },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return {
    userId: user.id,
    cookie: `${parsedCookie.name}=${parsedCookie.value}`,
  };
}

async function createTrack() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title: `Play Event Track ${suffix}`,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
}

function playEventRequest(cookie: string, type: string, trackId: string) {
  const formData = new FormData();
  formData.set("type", type);
  formData.set("trackId", trackId);
  const request = new Request("http://localhost/resources/play-event", {
    method: "POST",
    headers: { cookie },
    body: formData,
  });
  return {
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/resources/play-event",
  };
}

function statusOf(response: unknown) {
  return (response as { init?: { status?: number } }).init?.status;
}

describe("play-event resource", () => {
  beforeEach(async () => {
    resetPlayEventBudgets();
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

  test("records play_started for authenticated user", async () => {
    const { userId, cookie } = await createUserCookie();
    const track = await createTrack();

    const response = await action(
      playEventRequest(cookie, USAGE_EVENT_TYPES.play_started, track.id),
    );
    expect((response as { data: unknown }).data).toEqual({ ok: true });

    const event = await prisma.usageEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      type: "play_started",
      userId,
      trackId: track.id,
    });

    const day = getUtcDayStart();
    const stat = await prisma.dailyUsageStat.findUnique({
      where: { day_metric: { day, metric: USAGE_METRICS.plays_started } },
    });
    expect(stat?.value).toBe(1);
  });

  test("rejects invalid payload", async () => {
    const { cookie } = await createUserCookie();
    const track = await createTrack();

    const response = await action(playEventRequest(cookie, "not_a_real_type", track.id));

    expect(statusOf(response)).toBe(400);
  });

  test("rejects a trackId that does not exist and records nothing", async () => {
    const { cookie } = await createUserCookie();

    const response = await action(
      playEventRequest(cookie, USAGE_EVENT_TYPES.play_started, "not-a-real-track"),
    );

    expect(statusOf(response)).toBe(400);
    expect((response as { data: unknown }).data).toEqual({
      ok: false,
      error: "Unknown track",
    });
    expect(await prisma.usageEvent.count()).toBe(0);
  });

  test("rejects unauthenticated requests", async () => {
    const track = await createTrack();

    await expect(
      action(playEventRequest("", USAGE_EVENT_TYPES.play_started, track.id)),
    ).rejects.toBeInstanceOf(Response);
    expect(await prisma.usageEvent.count()).toBe(0);
  });

  test("returns 429 with Retry-After once the per-user budget is spent", async () => {
    const { cookie, userId } = await createUserCookie();

    // Exhaust the budget in-memory. The rate limiter is a pure counter, so we
    // don't need 60 real DB writes just to drive it to its ceiling.
    for (let i = 0; i < PLAY_EVENT_MAX_PER_WINDOW; i += 1) {
      consumePlayEventBudget(userId);
    }

    // The blocked request short-circuits before any track lookup or DB write.
    const blocked = await action(
      playEventRequest(cookie, USAGE_EVENT_TYPES.play_started, "any-track-id"),
    );

    expect(statusOf(blocked)).toBe(429);
    expect(
      (blocked as { init?: { headers?: Record<string, string> } }).init?.headers?.["Retry-After"],
    ).toBeDefined();
  });

  test("budgets are tracked per user, not globally", async () => {
    const first = await createUserCookie();
    const second = await createUserCookie();
    const track = await createTrack();

    // Exhaust the first user's budget in-memory.
    for (let i = 0; i < PLAY_EVENT_MAX_PER_WINDOW; i += 1) {
      consumePlayEventBudget(first.userId);
    }

    const otherUser = await action(
      playEventRequest(second.cookie, USAGE_EVENT_TYPES.play_started, track.id),
    );

    expect(statusOf(otherUser)).toBeUndefined();
  });
});

describe("consumePlayEventBudget", () => {
  beforeEach(() => {
    resetPlayEventBudgets();
  });

  test("allows up to the window budget, then blocks with a retry hint", () => {
    for (let i = 0; i < PLAY_EVENT_MAX_PER_WINDOW; i += 1) {
      expect(consumePlayEventBudget("user-x").allowed).toBe(true);
    }

    const blocked = consumePlayEventBudget("user-x");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
