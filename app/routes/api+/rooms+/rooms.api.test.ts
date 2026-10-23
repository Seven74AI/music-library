import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader as currentRoomLoader } from "#app/routes/api+/rooms+/current.tsx";
import { action as createRoomAction } from "#app/routes/api+/rooms+/index.tsx";
import { action as joinRoomAction } from "#app/routes/api+/rooms+/$roomCode.join.tsx";
import { action as leaveRoomAction } from "#app/routes/api+/rooms+/$roomCode.leave.tsx";
import { loader as qrLoader } from "#app/routes/api+/rooms+/$roomCode.qr.tsx";
import { loader as snapshotLoader } from "#app/routes/api+/rooms+/$roomCode.tsx";
import { action as endRoomAction } from "#app/routes/api+/rooms+/$roomCode.end.tsx";
import { action as queueAction } from "#app/routes/api+/rooms+/$roomCode.queue.tsx";
import { GUEST_TOKEN_COOKIE_NAME } from "#app/features/party-room/guest-token.server.ts";

async function cleanup() {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
  await prisma.trackAudioFile.deleteMany();
  await prisma.track.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.user.deleteMany();
}

async function createUserCookie(name = "Host") {
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

async function makeTrackWithAudio(title: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const track = await prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
  await prisma.trackAudioFile.create({
    data: {
      trackId: track.id,
      serviceId: track.serviceId,
      objectKey: `audio/tracks/local/${track.id}.mp3`,
      format: "mp3",
    },
  });
  return track;
}

describe("rooms API", () => {
  beforeEach(async () => {
    await cleanup();
  });

  test("create → join guest → snapshot → QR → queue add → end", async () => {
    const { cookie } = await createUserCookie("Host");

    const createRes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host", defaultJoinRole: "listener" }),
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { code: string; roomId: string };
    expect(created.code).toHaveLength(6);

    const joinRes = await joinRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Walkup" }),
      }),
      params: { roomCode: created.code },
    });
    expect(joinRes.status).toBe(200);
    const guestCookie = joinRes.headers.get("Set-Cookie");
    expect(guestCookie).toContain(GUEST_TOKEN_COOKIE_NAME);

    const snapRes = await snapshotLoader({
      request: new Request(`http://localhost/api/rooms/${created.code}`),
      params: { roomCode: created.code },
    });
    expect(snapRes.status).toBe(200);
    const snap = (await snapRes.json()) as { participants: unknown[]; queue: unknown[] };
    expect(snap.participants).toHaveLength(2);
    expect(snap.queue).toHaveLength(0);

    const qrRes = await qrLoader({
      request: new Request(`http://localhost/api/rooms/${created.code}/qr`),
      params: { roomCode: created.code },
    });
    expect(qrRes.status).toBe(200);
    const qr = (await qrRes.json()) as { joinUrl: string; qrDataUrl: string };
    expect(qr.joinUrl).toContain(`/rooms/${created.code}`);
    expect(qr.qrDataUrl.startsWith("data:image")).toBe(true);

    const track = await makeTrackWithAudio("Party Track");
    const queueRes = await queueAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/queue`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "add_track", trackId: track.id }),
      }),
      params: { roomCode: created.code },
    });
    expect(queueRes.status).toBe(200);
    const queued = (await queueRes.json()) as { queue: unknown[]; roomVersion: number };
    expect(queued.queue).toHaveLength(1);

    const endRes = await endRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/end`, {
        method: "POST",
        headers: { cookie },
      }),
      params: { roomCode: created.code },
    });
    expect(endRes.status).toBe(200);
    const ended = (await endRes.json()) as { status: string };
    expect(ended.status).toBe("ended");

    const afterEnd = await snapshotLoader({
      request: new Request(`http://localhost/api/rooms/${created.code}`),
      params: { roomCode: created.code },
    });
    expect(afterEnd.status).toBe(404);
  });

  test("snapshot includes me for guest cookie; leave clears guest cookie", async () => {
    const { cookie } = await createUserCookie("Host");

    const createRes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host", defaultJoinRole: "dj" }),
      }),
    });
    const created = (await createRes.json()) as { code: string };

    const joinRes = await joinRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Walkup DJ" }),
      }),
      params: { roomCode: created.code },
    });
    const guestSetCookie = joinRes.headers.get("Set-Cookie");
    expect(guestSetCookie).toBeTruthy();
    const guestCookie = parseString(guestSetCookie!)!;
    const guestCookieHeader = `${guestCookie.name}=${guestCookie.value}`;

    const snapRes = await snapshotLoader({
      request: new Request(`http://localhost/api/rooms/${created.code}`, {
        headers: { cookie: guestCookieHeader },
      }),
      params: { roomCode: created.code },
    });
    expect(snapRes.status).toBe(200);
    const snap = (await snapRes.json()) as {
      me: { displayName: string; role: string; userId: string | null } | null;
      queue: Array<{ addedByDisplayName?: string }>;
    };
    expect(snap.me).toMatchObject({
      displayName: "Walkup DJ",
      role: "dj",
      userId: null,
    });

    const leaveRes = await leaveRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/leave`, {
        method: "POST",
        headers: { cookie: guestCookieHeader },
      }),
      params: { roomCode: created.code },
    });
    expect(leaveRes.status).toBe(200);
    const leaveSetCookie = leaveRes.headers.get("Set-Cookie");
    expect(leaveSetCookie).toContain(GUEST_TOKEN_COOKIE_NAME);
    expect(leaveSetCookie).toMatch(/Max-Age=0|max-age=0/i);
  });

  test("guest joining a second room via cookie leaves the first seat", async () => {
    const hostA = await createUserCookie("Host A");
    const hostB = await createUserCookie("Host B");

    const roomARes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie: hostA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host A" }),
      }),
    });
    const roomA = (await roomARes.json()) as { code: string; roomId: string };

    const roomBRes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie: hostB.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host B" }),
      }),
    });
    const roomB = (await roomBRes.json()) as { code: string };

    const joinA = await joinRoomAction({
      request: new Request(`http://localhost/api/rooms/${roomA.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Walkup" }),
      }),
      params: { roomCode: roomA.code },
    });
    const guestSetCookie = joinA.headers.get("Set-Cookie");
    expect(guestSetCookie).toBeTruthy();
    const guestCookie = parseString(guestSetCookie!)!;
    const guestCookieHeader = `${guestCookie.name}=${guestCookie.value}`;

    const joinB = await joinRoomAction({
      request: new Request(`http://localhost/api/rooms/${roomB.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: guestCookieHeader },
        body: JSON.stringify({ displayName: "Walkup" }),
      }),
      params: { roomCode: roomB.code },
    });
    expect(joinB.status).toBe(200);

    const activeA = await prisma.roomParticipant.count({
      where: { roomId: roomA.roomId, leftAt: null },
    });
    expect(activeA).toBe(1);
  });

  test("GET /api/rooms/current returns the signed-in open seat or 204", async () => {
    const host = await createUserCookie("Host");
    const other = await createUserCookie("Listener");

    const anonymous = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current"),
    });
    expect(anonymous.status).toBe(204);

    const none = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: host.cookie },
      }),
    });
    expect(none.status).toBe(204);

    const createRes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie: host.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host", defaultJoinRole: "listener" }),
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { code: string; roomId: string };

    const track = await makeTrackWithAudio("Now Playing");
    const queueRes = await queueAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/queue`, {
        method: "POST",
        headers: { cookie: host.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "add_track", trackId: track.id }),
      }),
      params: { roomCode: created.code },
    });
    expect(queueRes.status).toBe(200);

    const current = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: host.cookie },
      }),
    });
    expect(current.status).toBe(200);
    const body = (await current.json()) as {
      code: string;
      roomId: string;
      status: string;
      queue: Array<{ trackId: string }>;
      participants: Array<{ userId: string | null }>;
      me: { userId: string | null; role: string } | null;
    };
    expect(body.code).toBe(created.code);
    expect(body.roomId).toBe(created.roomId);
    expect(body.status).toBe("open");
    expect(body.queue.map((item) => item.trackId)).toEqual([track.id]);
    expect(body.participants.some((p) => p.userId === host.userId)).toBe(true);
    expect(body.me).toMatchObject({ userId: host.userId, role: "host" });

    const stranger = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: other.cookie },
      }),
    });
    expect(stranger.status).toBe(204);

    const joinRes = await joinRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/join`, {
        method: "POST",
        headers: { cookie: other.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Listener" }),
      }),
      params: { roomCode: created.code },
    });
    expect(joinRes.status).toBe(200);

    const joined = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: other.cookie },
      }),
    });
    expect(joined.status).toBe(200);
    const joinedBody = (await joined.json()) as { code: string; me: { role: string } | null };
    expect(joinedBody.code).toBe(created.code);
    expect(joinedBody.me?.role).toBe("listener");

    const leaveRes = await leaveRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/leave`, {
        method: "POST",
        headers: { cookie: host.cookie },
      }),
      params: { roomCode: created.code },
    });
    expect(leaveRes.status).toBe(200);

    const afterLeave = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: host.cookie },
      }),
    });
    expect(afterLeave.status).toBe(204);

    const stillOpen = await prisma.room.findUniqueOrThrow({ where: { id: created.roomId } });
    expect(stillOpen.status).toBe("open");
  });

  test("GET /api/rooms/current returns the guest cookie seat so presence can heartbeat", async () => {
    const host = await createUserCookie("Host");

    const createRes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie: host.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host", defaultJoinRole: "listener" }),
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { code: string; roomId: string };

    const joinRes = await joinRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Walkup" }),
      }),
      params: { roomCode: created.code },
    });
    expect(joinRes.status).toBe(200);
    const guestSetCookie = joinRes.headers.get("Set-Cookie");
    expect(guestSetCookie).toBeTruthy();
    const guestCookie = parseString(guestSetCookie!)!;
    const guestCookieHeader = `${guestCookie.name}=${guestCookie.value}`;

    const signedOut = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current"),
    });
    expect(signedOut.status).toBe(204);

    const track = await makeTrackWithAudio("Guest Queue");
    const queueRes = await queueAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/queue`, {
        method: "POST",
        headers: { cookie: host.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "add_track", trackId: track.id }),
      }),
      params: { roomCode: created.code },
    });
    expect(queueRes.status).toBe(200);

    const current = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: guestCookieHeader },
      }),
    });
    expect(current.status).toBe(200);
    const body = (await current.json()) as {
      code: string;
      roomId: string;
      status: string;
      queue: Array<{ trackId: string }>;
      me: { displayName: string; role: string; userId: string | null } | null;
    };
    expect(body.code).toBe(created.code);
    expect(body.roomId).toBe(created.roomId);
    expect(body.status).toBe("open");
    expect(body.queue.map((item) => item.trackId)).toEqual([track.id]);
    expect(body.me).toMatchObject({
      displayName: "Walkup",
      role: "listener",
      userId: null,
    });

    const afterLeave = await leaveRoomAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/leave`, {
        method: "POST",
        headers: { cookie: guestCookieHeader },
      }),
      params: { roomCode: created.code },
    });
    expect(afterLeave.status).toBe(200);

    const left = await currentRoomLoader({
      request: new Request("http://localhost/api/rooms/current", {
        headers: { cookie: guestCookieHeader },
      }),
    });
    expect(left.status).toBe(204);
  });

  test("skip at last queue item stops playback instead of staying playing", async () => {
    const { cookie } = await createUserCookie("Host");

    const createRes = await createRoomAction({
      request: new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Host", defaultJoinRole: "listener" }),
      }),
    });
    const created = (await createRes.json()) as { code: string };
    const t1 = await makeTrackWithAudio("One");
    const t2 = await makeTrackWithAudio("Two");

    for (const track of [t1, t2]) {
      const addRes = await queueAction({
        request: new Request(`http://localhost/api/rooms/${created.code}/queue`, {
          method: "POST",
          headers: { cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "add_track", trackId: track.id }),
        }),
        params: { roomCode: created.code },
      });
      expect(addRes.status).toBe(200);
    }

    const firstSkip = await queueAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/queue`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "skip" }),
      }),
      params: { roomCode: created.code },
    });
    expect(firstSkip.status).toBe(200);
    const mid = (await firstSkip.json()) as { currentIndex: number; isPlaying: boolean };
    expect(mid.currentIndex).toBe(1);
    expect(mid.isPlaying).toBe(true);

    const lastSkip = await queueAction({
      request: new Request(`http://localhost/api/rooms/${created.code}/queue`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "skip" }),
      }),
      params: { roomCode: created.code },
    });
    expect(lastSkip.status).toBe(200);
    const ended = (await lastSkip.json()) as { currentIndex: number; isPlaying: boolean };
    expect(ended.currentIndex).toBe(1);
    expect(ended.isPlaying).toBe(false);
  });
});
