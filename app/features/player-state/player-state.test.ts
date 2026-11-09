import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { action, loader } from "#app/routes/resources+/player-state.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { type QueueNavigationState } from "#app/features/queue/queue-navigation.ts";
import {
  inferAudibleSourceForRestore,
  isAudibleSourceZoneUnknown,
  withPlayerStateDefaults,
  type PlayerStateData,
} from "./player-state.ts";

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

const sampleState: PlayerStateData = {
  playContext: { type: "playlist", playlistId: "pl-1" },
  currentTrackId: "track-1",
  upNextIds: ["track-2", "track-3"],
  shuffleSeed: 42,
  loopMode: "all",
  spinePosition: 2,
  audibleSourceZone: "upNext",
  upNextPlayNextCount: 1,
};

function saveRequest(cookie: string, body: unknown) {
  return new Request("http://localhost/resources/player-state", {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loadRequest(cookie: string) {
  return new Request("http://localhost/resources/player-state", {
    method: "GET",
    headers: { cookie },
  });
}

describe("isAudibleSourceZoneUnknown", () => {
  test("treats null and undefined as unknown", () => {
    expect(isAudibleSourceZoneUnknown(null)).toBe(true);
    expect(isAudibleSourceZoneUnknown(undefined)).toBe(true);
  });

  test("treats explicit spine and upNext as known", () => {
    expect(isAudibleSourceZoneUnknown("spine")).toBe(false);
    expect(isAudibleSourceZoneUnknown("upNext")).toBe(false);
  });
});

describe("inferAudibleSourceForRestore", () => {
  const navigation: QueueNavigationState = {
    upNext: [],
    spine: [
      { id: "track-1", title: "One" } as never,
      { id: "track-2", title: "Two" } as never,
      { id: "track-3", title: "Three" } as never,
    ],
    spineOrder: [0, 1, 2],
    spinePosition: 0,
    loopMode: "off",
  };

  test("re-infers spine zone + position when zone is unknown", () => {
    expect(inferAudibleSourceForRestore(true, null, 0, navigation, "track-3", [])).toEqual({
      audibleSourceZone: "spine",
      spinePosition: 2,
    });
  });

  test("keeps explicit upNext zone without re-inferring spine", () => {
    expect(
      inferAudibleSourceForRestore(false, "upNext", 2, navigation, "track-up", ["track-up"]),
    ).toEqual({ audibleSourceZone: "upNext", spinePosition: 2 });
  });
});

describe("withPlayerStateDefaults", () => {
  test("keeps null audibleSourceZone as unknown (not a concrete zone)", () => {
    const resolved = withPlayerStateDefaults({
      playContext: null,
      currentTrackId: "track-1",
      upNextIds: [],
      shuffleSeed: null,
      loopMode: "off",
      audibleSourceZone: null,
      spinePosition: 0,
    });
    expect(resolved.audibleSourceZone).toBeNull();
    expect(isAudibleSourceZoneUnknown(resolved.audibleSourceZone)).toBe(true);
  });
});

describe("player-state resource", () => {
  beforeEach(async () => {
    await prisma.playerState.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });
  });

  test("GET sanitizes invalid stored loopMode via schema", async () => {
    const { userId, cookie } = await createUserCookie();
    await prisma.playerState.create({
      data: {
        userId,
        playContext: null,
        currentTrackId: null,
        upNextIds: "[]",
        shuffleSeed: null,
        loopMode: "bogus",
      },
    });

    const response = await loader({
      request: loadRequest(cookie),
      params: {},
      context: {},
    } as never);

    expect((response as Response).ok).toBe(true);
    const body = (await (response as Response).json()) as PlayerStateData;
    expect(body.loopMode).toBe("off");
    expect(body.upNextIds).toEqual([]);
  });

  test("save/load round-trips the persisted queue", async () => {
    const { userId, cookie } = await createUserCookie();

    const saveResponse = await action({
      request: saveRequest(cookie, sampleState),
      params: {},
      context: {},
    } as never);

    expect((saveResponse as Response).ok).toBe(true);

    const row = await prisma.playerState.findUniqueOrThrow({ where: { userId } });
    expect(row.currentTrackId).toBe("track-1");
    expect(row.shuffleSeed).toBe(42);
    expect(row.loopMode).toBe("all");
    expect(JSON.parse(row.upNextIds)).toEqual(["track-2", "track-3"]);
    expect(JSON.parse(row.playContext!)).toEqual({
      type: "playlist",
      playlistId: "pl-1",
    });

    const loadResponse = (await loader({
      request: loadRequest(cookie),
      params: {},
      context: {},
    } as never)) as Response;
    expect(loadResponse.status).toBe(200);
    expect(await loadResponse.json()).toEqual(sampleState);
    expect(row.spinePosition).toBe(2);
    expect(row.audibleSourceZone).toBe("upNext");
    expect(row.upNextPlayNextCount).toBe(1);
  });

  test("defaults queue-position fields when omitted from the request body", async () => {
    const { cookie } = await createUserCookie();
    const legacyBody = {
      playContext: { type: "library" as const },
      currentTrackId: "track-1",
      upNextIds: [] as string[],
      shuffleSeed: null,
      loopMode: "off" as const,
    };

    const saveResponse = await action({
      request: saveRequest(cookie, legacyBody),
      params: {},
      context: {},
    } as never);

    expect((saveResponse as Response).ok).toBe(true);

    const loadResponse = (await loader({
      request: loadRequest(cookie),
      params: {},
      context: {},
    } as never)) as Response;

    expect(await loadResponse.json()).toEqual({
      ...legacyBody,
      spinePosition: 0,
      audibleSourceZone: null,
      upNextPlayNextCount: 0,
    });
  });

  test("upserts on the unique userId (one row per user)", async () => {
    const { userId, cookie } = await createUserCookie();

    await action({
      request: saveRequest(cookie, sampleState),
      params: {},
      context: {},
    } as never);
    await action({
      request: saveRequest(cookie, {
        ...sampleState,
        currentTrackId: "track-9",
        shuffleSeed: null,
      }),
      params: {},
      context: {},
    } as never);

    expect(await prisma.playerState.count()).toBe(1);
    const row = await prisma.playerState.findUniqueOrThrow({ where: { userId } });
    expect(row.currentTrackId).toBe("track-9");
    expect(row.shuffleSeed).toBeNull();
  });

  test("loads 204 when the user has no saved queue", async () => {
    const { cookie } = await createUserCookie();

    const response = (await loader({
      request: loadRequest(cookie),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(204);
  });

  test("rejects an invalid payload with 400 and persists nothing", async () => {
    const { cookie } = await createUserCookie();

    const response = (await action({
      request: saveRequest(cookie, { ...sampleState, loopMode: "invalid" }),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(400);
    expect(await prisma.playerState.count()).toBe(0);
  });

  test("rejects a non-PUT action with 405", async () => {
    const { cookie } = await createUserCookie();

    const request = new Request("http://localhost/resources/player-state", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(sampleState),
    });

    const response = (await action({
      request,
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(405);
  });

  test("rejects unauthenticated requests", async () => {
    await expect(
      action({ request: saveRequest("", sampleState), params: {}, context: {} } as never),
    ).rejects.toBeInstanceOf(Response);
    expect(await prisma.playerState.count()).toBe(0);
  });

  test("persists a uint32 shuffle seed that exceeds Prisma signed Int", async () => {
    const { userId, cookie } = await createUserCookie();

    const response = await action({
      request: saveRequest(cookie, { ...sampleState, shuffleSeed: 0xffffffff }),
      params: {},
      context: {},
    } as never);

    expect((response as Response).ok).toBe(true);

    const row = await prisma.playerState.findUniqueOrThrow({ where: { userId } });
    expect(row.shuffleSeed).toBe(0x7fffffff);
  });
});
