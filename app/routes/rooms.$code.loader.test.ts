import { beforeEach, describe, expect, test } from "vitest";
import { createRoom } from "#app/features/party-room/party-room.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
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
