import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createRoom,
  isRoomEventStreamAuthorized,
  joinRoom,
  kickParticipant,
  leaveRoom,
} from "#app/features/party-room/party-room.server.ts";
import {
  resetRoomSseConnections,
  roomSubscriberCount,
} from "#app/features/party-room/sse.server.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader as eventsLoader } from "./$roomCode.events.tsx";

async function cleanup() {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
  await prisma.user.deleteMany();
  resetRoomSseConnections();
}

async function createUserCookie(name = "User") {
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      name,
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

describe("room events SSE re-authorization", () => {
  beforeEach(async () => {
    await cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("isRoomEventStreamAuthorized is false after kick or leave", async () => {
    const host = await createUserCookie("Host");
    const guest = await createUserCookie("Guest");
    const created = await createRoom({ userId: host.userId, displayName: "Host" });
    const joined = await joinRoom({
      code: created.code,
      actor: { type: "user", userId: guest.userId, displayName: "Guest" },
    });
    const actor = { type: "user" as const, userId: guest.userId };

    expect(await isRoomEventStreamAuthorized(created.id, actor)).toBe(true);

    await kickParticipant({
      roomId: created.id,
      actor: { type: "user", userId: host.userId },
      targetParticipantId: joined.participant.id,
    });
    expect(await isRoomEventStreamAuthorized(created.id, actor)).toBe(false);

    const rejoined = await joinRoom({
      code: created.code,
      actor: { type: "user", userId: guest.userId, displayName: "Guest" },
    });
    expect(await isRoomEventStreamAuthorized(created.id, actor)).toBe(true);

    await leaveRoom({ roomId: created.id, actor });
    expect(await isRoomEventStreamAuthorized(created.id, actor)).toBe(false);
    expect(rejoined.participant.id).toBeTruthy();
  });

  test("closes the SSE stream on heartbeat after the participant is kicked", async () => {
    const host = await createUserCookie("Host");
    const guest = await createUserCookie("Guest");
    const created = await createRoom({ userId: host.userId, displayName: "Host" });
    const joined = await joinRoom({
      code: created.code,
      actor: { type: "user", userId: guest.userId, displayName: "Guest" },
    });

    const response = await eventsLoader({
      request: new Request(`http://localhost/api/rooms/${created.code}/events`, {
        headers: { cookie: guest.cookie },
      }),
      params: { roomCode: created.code },
      context: {},
    } as never);

    expect(response).toBeInstanceOf(Response);
    expect(roomSubscriberCount(created.id)).toBe(1);

    const reader = (response as Response).body!.getReader();
    await reader.read();

    await kickParticipant({
      roomId: created.id,
      actor: { type: "user", userId: host.userId },
      targetParticipantId: joined.participant.id,
    });

    await vi.advanceTimersByTimeAsync(15_000);

    await vi.waitFor(async () => {
      expect(roomSubscriberCount(created.id)).toBe(0);
    });

    await vi.waitFor(async () => {
      let chunk = await reader.read();
      while (!chunk.done) {
        chunk = await reader.read();
      }
      expect(chunk.done).toBe(true);
    });
  });
});
