import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { action, loader } from "#app/routes/resources+/player-state.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { type PlayerStateData } from "./player-state.ts";

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
});
