import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader as apiHistoryLoader } from "./api+/history.tsx";
import { loader as historyLoader } from "./history.tsx";

type HistoryItem = {
  id: string;
  playId: string | null;
  completed: boolean;
  playedAt: string | Date;
  track: { id: string; title: string };
};

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

async function createPlayStarted({
  userId,
  trackId,
  playId,
  createdAt,
  id,
}: {
  userId: string;
  trackId: string;
  playId?: string;
  createdAt: Date;
  id?: string;
}) {
  return prisma.usageEvent.create({
    data: {
      id,
      type: USAGE_EVENT_TYPES.play_started,
      userId,
      trackId,
      playId: playId ?? null,
      createdAt,
    },
  });
}

async function createPlayCompleted({
  userId,
  trackId,
  playId,
  createdAt,
}: {
  userId: string;
  trackId: string;
  playId: string;
  createdAt: Date;
}) {
  return prisma.usageEvent.create({
    data: {
      type: USAGE_EVENT_TYPES.play_completed,
      userId,
      trackId,
      playId,
      createdAt,
    },
  });
}

function pageRequest(cookie: string, url = "http://localhost/history") {
  const request = new Request(url, { headers: { cookie } });
  return { request, url: new URL(request.url), params: {}, context: {} };
}

function readHistoryData(response: unknown): { items: HistoryItem[]; nextCursor: string | null } {
  return (response as { data: { items: HistoryItem[]; nextCursor: string | null } }).data;
}

const T0 = new Date("2026-08-30T10:00:00.000Z");

function at(seconds: number) {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("play history route loaders", () => {
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

  test("redirects unauthenticated requests", async () => {
    await expect(historyLoader(pageRequest("") as never)).rejects.toBeInstanceOf(Response);
  });

  test("lists plays most recent first with completed flags", async () => {
    const { userId, cookie } = await createUserCookie();
    const a = await createTrack("Track A");
    const b = await createTrack("Track B");
    const c = await createTrack("Track C");

    // c is newest, then b, then a (oldest).
    await createPlayStarted({ userId, trackId: c.id, playId: "play-c", createdAt: at(30) });
    await createPlayStarted({ userId, trackId: b.id, playId: "play-b", createdAt: at(20) });
    await createPlayStarted({ userId, trackId: a.id, playId: "play-a", createdAt: at(10) });

    // Only c and a reached completion.
    await createPlayCompleted({ userId, trackId: c.id, playId: "play-c", createdAt: at(35) });
    await createPlayCompleted({ userId, trackId: a.id, playId: "play-a", createdAt: at(15) });

    const { items } = readHistoryData(await historyLoader(pageRequest(cookie) as never));

    expect(items.map((item) => item.track.id)).toEqual([c.id, b.id, a.id]);
    expect(items.map((item) => item.completed)).toEqual([true, false, true]);
  });

  test("shows repeated plays of the same track as separate entries", async () => {
    const { userId, cookie } = await createUserCookie();
    const track = await createTrack("Repeat Me");

    await createPlayStarted({ userId, trackId: track.id, playId: "play-1", createdAt: at(10) });
    await createPlayStarted({ userId, trackId: track.id, playId: "play-2", createdAt: at(20) });

    const { items } = readHistoryData(await historyLoader(pageRequest(cookie) as never));

    expect(items).toHaveLength(2);
    expect(items[0]!.track.id).toBe(track.id);
    expect(items[1]!.track.id).toBe(track.id);
    expect(items[0]!.id).not.toBe(items[1]!.id);
  });

  test("omits play events whose track no longer exists", async () => {
    const { userId, cookie } = await createUserCookie();
    const track = await createTrack("Still Here");

    await createPlayStarted({ userId, trackId: track.id, playId: "play-keep", createdAt: at(20) });
    await createPlayStarted({
      userId,
      trackId: "deleted-track-id",
      playId: "play-gone",
      createdAt: at(10),
    });

    const { items } = readHistoryData(await historyLoader(pageRequest(cookie) as never));

    expect(items).toHaveLength(1);
    expect(items[0]!.track.id).toBe(track.id);
  });

  test("pages backward through history stably via cursor", async () => {
    const { userId, cookie } = await createUserCookie();
    const a = await createTrack("Track A");
    const b = await createTrack("Track B");
    const c = await createTrack("Track C");

    await createPlayStarted({ userId, trackId: c.id, playId: "play-c", createdAt: at(30) });
    await createPlayStarted({ userId, trackId: b.id, playId: "play-b", createdAt: at(20) });
    await createPlayStarted({ userId, trackId: a.id, playId: "play-a", createdAt: at(10) });

    const page1 = await apiHistoryLoader(
      pageRequest(cookie, "http://localhost/api/history?limit=2") as never,
    );
    const body1 = (await page1.json()) as { items: HistoryItem[]; nextCursor: string | null };
    expect(body1.items.map((item) => item.track.id)).toEqual([c.id, b.id]);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await apiHistoryLoader(
      pageRequest(
        cookie,
        `http://localhost/api/history?limit=2&cursor=${body1.nextCursor}`,
      ) as never,
    );
    const body2 = (await page2.json()) as { items: HistoryItem[]; nextCursor: string | null };
    expect(body2.items.map((item) => item.track.id)).toEqual([a.id]);
    expect(body2.nextCursor).toBeNull();
  });

  test("orders events sharing a createdAt by id tiebreaker", async () => {
    const { userId, cookie } = await createUserCookie();
    const a = await createTrack("Track A");
    const b = await createTrack("Track B");

    // Same millisecond, distinct ids: "e2" sorts after "e1".
    await createPlayStarted({
      userId,
      trackId: a.id,
      playId: "play-a",
      createdAt: at(10),
      id: "e1",
    });
    await createPlayStarted({
      userId,
      trackId: b.id,
      playId: "play-b",
      createdAt: at(10),
      id: "e2",
    });

    const { items } = readHistoryData(await historyLoader(pageRequest(cookie) as never));

    expect(items.map((item) => item.id)).toEqual(["e2", "e1"]);
  });
});
