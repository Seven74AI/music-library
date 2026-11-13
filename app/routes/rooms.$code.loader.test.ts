import { beforeEach, describe, expect, test, vi } from "vitest";
import * as partyRoomServer from "#app/features/party-room/party-room.server.ts";
import { createRoom } from "#app/features/party-room/party-room.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { sessionKey } from "#app/utils/auth.server.ts";
import { action, loader as indexLoader } from "./rooms.$code._index.tsx";
import { loader } from "./rooms.$code.tsx";

async function cleanupRooms() {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
}

async function createHost() {
  return prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });
}

describe("guest /rooms/:code loader", () => {
  beforeEach(async () => {
    await cleanupRooms();
  });

  test("index loader returns the guest join shell when the room has ended", async () => {
    const host = await createHost();
    await prisma.room.create({
      data: {
        code: "AB3K9Q",
        status: "ended",
        endedAt: new Date(),
        originalHostUserId: host.id,
      },
    });

    const result = await indexLoader({
      request: new Request("http://localhost/rooms/AB3K9Q"),
      params: { code: "AB3K9Q" },
    });
    expect(result).toMatchObject({ code: "AB3K9Q", seated: false, participant: null });
  });

  test("a later visit says the room ended only when that room row is ended", async () => {
    const host = await createHost();
    await prisma.room.create({
      data: {
        code: "AB3K9Q",
        status: "ended",
        endedAt: new Date(),
        originalHostUserId: host.id,
      },
    });

    const ended = await loader({
      request: new Request("http://localhost/rooms/AB3K9Q"),
      params: { code: "AB3K9Q" },
    } as never);
    expect(ended.data).toMatchObject({
      mode: "guest",
      ended: true,
      room: null,
      invalidCode: false,
    });

    const missing = await loader({
      request: new Request("http://localhost/rooms/ZZZZ99"),
      params: { code: "ZZZZ99" },
    } as never);
    expect(missing.data).toMatchObject({
      mode: "guest",
      ended: false,
      room: null,
      invalidCode: false,
    });
  });

  test("rethrows transient findOpenRoomByCode failures instead of showing not-found", async () => {
    const host = await createHost();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    vi.spyOn(partyRoomServer, "findOpenRoomByCode").mockRejectedValueOnce(
      new Error("SQLITE_BUSY: database is locked"),
    );

    await expect(
      loader({
        request: new Request(`http://localhost/rooms/${room.code}`),
        params: { code: room.code },
      } as never),
    ).rejects.toThrow();
  });

  test("an open room still loads the guest shell", async () => {
    const host = await createHost();
    const room = await createRoom({ userId: host.id, displayName: "Host" });

    const result = await loader({
      request: new Request(`http://localhost/rooms/${room.code}`),
      params: { code: room.code },
    } as never);

    expect(result.data.mode).toBe("guest");
    if (result.data.mode !== "guest") {
      throw new Error("expected guest loader");
    }
    expect(result.data).toMatchObject({
      code: room.code,
      ended: false,
      invalidCode: false,
      participant: null,
    });
    expect(result.data.room?.status).toBe("open");
  });

  test("a non-seated guest load omits playback and room-version fields", async () => {
    const host = await createHost();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    await prisma.room.update({
      where: { id: room.id },
      data: { currentIndex: 2, isPlaying: true, roomVersion: 9 },
    });

    const result = await loader({
      request: new Request(`http://localhost/rooms/${room.code}`),
      params: { code: room.code },
    } as never);

    expect(result.data.mode).toBe("guest");
    if (result.data.mode !== "guest") {
      throw new Error("expected guest loader");
    }
    expect(result.data.participant).toBeNull();
    expect(result.data.room).toMatchObject({
      code: room.code,
      status: "open",
    });
    expect(result.data.room).not.toHaveProperty("currentIndex");
    expect(result.data.room).not.toHaveProperty("isPlaying");
    expect(result.data.room).not.toHaveProperty("roomVersion");
  });

  test("a non-seated guest load never exposes queue rows or participant ids", async () => {
    const host = await createHost();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const suffix = `${Date.now()}-loader`;
    const service = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: { name: "local", displayName: "Local", baseUrl: "", isActive: true },
    });
    const track = await prisma.track.create({
      data: {
        title: "Queued",
        externalId: `queued-${suffix}`,
        service: { connect: { id: service.id } },
        artist: {
          create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
        },
      },
    });
    await prisma.roomQueueItem.create({
      data: {
        roomId: room.id,
        trackId: track.id,
        position: 0,
        addedByParticipantId: room.participants[0]!.id,
      },
    });

    const result = await loader({
      request: new Request(`http://localhost/rooms/${room.code}`),
      params: { code: room.code },
    } as never);

    expect(result.data.mode).toBe("guest");
    if (result.data.mode !== "guest") {
      throw new Error("expected guest loader");
    }
    expect(result.data.queue).toEqual([]);
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain("addedByParticipantId");
    expect(serialized).not.toMatch(/"userId"\s*:\s*"[^"]+"/);
  });

  test("stale session cookie on guest loader clears auth cookie without redirect", async () => {
    const deletedSessionId = `stale-${Math.random().toString(36).slice(2, 12)}`;
    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, deletedSessionId);
    const cookie = await authSessionStorage.commitSession(authSession);

    const response = await loader({
      request: new Request("http://localhost/rooms/AB3K9Q", {
        headers: { cookie },
      }),
      params: { code: "AB3K9Q" },
    } as never);

    expect(response.data).toMatchObject({ mode: "guest" });
    expect(new Headers(response.init?.headers).get("set-cookie")).toBeTruthy();
  });

  test("stale session cookie on guest join action clears auth cookie", async () => {
    const host = await createHost();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const deletedSessionId = `stale-${Math.random().toString(36).slice(2, 12)}`;
    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, deletedSessionId);
    const cookie = await authSessionStorage.commitSession(authSession);

    const formData = new FormData();
    formData.set("displayName", "Guest Player");

    const response = await action({
      request: new Request(`http://localhost/rooms/${room.code}`, {
        method: "POST",
        headers: { cookie },
        body: formData,
      }),
      params: { code: room.code },
    });

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("expected redirect Response");
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  test("codes that use 0, O, or I are invalid room codes", async () => {
    for (const code of ["AB3K0Q", "OOOOOO", "IIIIII"]) {
      const result = await loader({
        request: new Request(`http://localhost/rooms/${code}`),
        params: { code },
      } as never);
      expect(result.data).toMatchObject({
        mode: "guest",
        invalidCode: true,
        ended: false,
        room: null,
      });
    }
  });
});
