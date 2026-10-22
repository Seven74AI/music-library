import { beforeEach, describe, expect, test } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { ROOM_STATUS } from "./constants.ts";
import {
  findOpenGuestSeatFromCookie,
  maybeRedirectLoggedOutGuestToOpenRoom,
} from "./guest-return.server.ts";
import { createGuestToken, serializeGuestTokenCookie } from "./guest-token.server.ts";
import { createRoom, joinRoom, leaveRoom } from "./party-room.server.ts";
import { resetRoomSseConnections } from "./sse.server.ts";

async function cleanup() {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
  resetRoomSseConnections();
}

async function makeUser(name = "Host User") {
  return prisma.user.create({
    data: {
      ...createUser(),
      name,
      roles: { connect: { name: "user" } },
    },
  });
}

async function guestCookieHeader(token: string) {
  const setCookie = await serializeGuestTokenCookie(token);
  const pair = setCookie.split(";")[0];
  if (!pair) throw new Error("expected guest cookie");
  return pair;
}

function requestFor(pathname: string, cookie?: string, method = "GET") {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request(new URL(pathname, "http://localhost"), { method, headers });
}

async function seatGuest(displayName = "Walkup") {
  const host = await makeUser();
  const room = await createRoom({ userId: host.id, displayName: "Host" });
  const joined = await joinRoom({
    code: room.code,
    actor: { type: "guest", displayName },
  });
  if (!joined.guestToken) throw new Error("expected guest token");
  const cookie = await guestCookieHeader(joined.guestToken);
  return { host, room, joined, cookie, token: joined.guestToken };
}

async function expectGuestRedirect(request: Request, roomCode: string) {
  try {
    await maybeRedirectLoggedOutGuestToOpenRoom(request);
    expect.fail("expected a redirect into the open room");
  } catch (error) {
    expect(error).toHaveRedirect(`/rooms/${roomCode}`);
  }
}

function callRootLoader(request: Request) {
  return rootLoader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/",
  });
}

describe("open guest seat from the guest cookie", () => {
  beforeEach(async () => {
    await cleanup();
  });

  test("resolves the open room for the joining browser", async () => {
    const { room, cookie } = await seatGuest();

    const seat = await findOpenGuestSeatFromCookie(requestFor("/", cookie));

    expect(seat).toEqual({ roomCode: room.code });
  });

  test("returns null for another browser with no cookie", async () => {
    await seatGuest();

    const seat = await findOpenGuestSeatFromCookie(requestFor("/"));

    expect(seat).toBeNull();
  });

  test("returns null when the cookie does not match a seat", async () => {
    await seatGuest();
    const cookie = await guestCookieHeader(createGuestToken());

    const seat = await findOpenGuestSeatFromCookie(requestFor("/", cookie));

    expect(seat).toBeNull();
  });

  test("returns null after the guest leaves", async () => {
    const { room, cookie, token } = await seatGuest();
    await leaveRoom({ roomId: room.id, actor: { type: "guest", guestToken: token } });

    const seat = await findOpenGuestSeatFromCookie(requestFor("/", cookie));

    expect(seat).toBeNull();
  });

  test("returns null when the room has ended", async () => {
    const { room, cookie } = await seatGuest();
    await prisma.room.update({
      where: { id: room.id },
      data: { status: ROOM_STATUS.ended, endedAt: new Date() },
    });

    const seat = await findOpenGuestSeatFromCookie(requestFor("/", cookie));

    expect(seat).toBeNull();
  });
});

describe("logged-out return to the open guest room", () => {
  beforeEach(async () => {
    await cleanup();
  });

  test("redirects a document request to /rooms/:code", async () => {
    const { room, cookie } = await seatGuest();

    await expectGuestRedirect(requestFor("/", cookie), room.code);
    await expectGuestRedirect(requestFor("/about", cookie), room.code);
    await expectGuestRedirect(requestFor("/rooms", cookie), room.code);
  });

  test("does not redirect when the cookie is missing", async () => {
    await seatGuest();

    await expect(maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/"))).resolves.toBeUndefined();
  });

  test("does not redirect when the room has ended", async () => {
    const { room, cookie } = await seatGuest();
    await prisma.room.update({
      where: { id: room.id },
      data: { status: ROOM_STATUS.ended, endedAt: new Date() },
    });

    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/", cookie)),
    ).resolves.toBeUndefined();
  });

  test("does not redirect after Leave even if the cookie is still presented", async () => {
    const { room, cookie, token } = await seatGuest();
    await leaveRoom({ roomId: room.id, actor: { type: "guest", guestToken: token } });

    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/", cookie)),
    ).resolves.toBeUndefined();
  });

  test("does not redirect when the request is already /rooms/:code", async () => {
    const { room, cookie } = await seatGuest();

    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor(`/rooms/${room.code}`, cookie)),
    ).resolves.toBeUndefined();
    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor(`/rooms/${room.code}/search`, cookie)),
    ).resolves.toBeUndefined();
    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/rooms/OTHER1", cookie)),
    ).resolves.toBeUndefined();
  });

  test("does not redirect API or resource routes", async () => {
    const { cookie } = await seatGuest();

    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/api/rooms/current", cookie)),
    ).resolves.toBeUndefined();
    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/resources/healthcheck", cookie)),
    ).resolves.toBeUndefined();
  });

  test("does not redirect single-fetch data requests", async () => {
    const { cookie } = await seatGuest();

    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/_.data", cookie)),
    ).resolves.toBeUndefined();
    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/about.data", cookie)),
    ).resolves.toBeUndefined();
  });

  test("does not redirect a non-GET document request", async () => {
    const { cookie } = await seatGuest();

    await expect(
      maybeRedirectLoggedOutGuestToOpenRoom(requestFor("/", cookie, "POST")),
    ).resolves.toBeUndefined();
  });
});

describe("root loader guest return", () => {
  beforeEach(async () => {
    await cleanup();
  });

  test("logged-out GET / with an open seat redirects to /rooms/:code", async () => {
    const { room, cookie } = await seatGuest();

    try {
      await callRootLoader(requestFor("/", cookie));
      expect.fail("expected the root loader to redirect");
    } catch (error) {
      expect(error).toHaveRedirect(`/rooms/${room.code}`);
    }
  });

  test("logged-out GET / without a cookie stays on the home loader", async () => {
    const result = await callRootLoader(requestFor("/"));

    expect(result).toMatchObject({ data: { user: null } });
  });

  test("a signed-in GET / does not redirect into the guest room", async () => {
    const { cookie, host } = await seatGuest();
    const session = await prisma.session.create({
      data: {
        expirationDate: getSessionExpirationDate(),
        userId: host.id,
      },
    });
    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, session.id);
    const setCookieHeader = await authSessionStorage.commitSession(authSession);
    const authPair = setCookieHeader.split(";")[0];
    const request = requestFor("/", `${authPair}; ${cookie}`);

    const result = await callRootLoader(request);

    expect(result).toMatchObject({ data: { user: { id: host.id } } });
  });
});
