import { randomBytes } from "node:crypto";
import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { resetAuditionGrants } from "#app/features/party-room/audition.server.ts";
import { generateRoomCode } from "#app/features/party-room/codes.ts";
import {
  createGuestToken,
  hashGuestToken,
  serializeGuestTokenCookie,
} from "#app/features/party-room/guest-token.server.ts";
import { resetPartyRoomRateLimits } from "#app/features/party-room/rate-limit.server.ts";
import { action as auditionAction } from "#app/routes/api+/rooms+/$roomCode.audition.ts";
import { loader as searchLoader } from "#app/routes/api+/rooms+/$roomCode.search.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";

async function seedOpenRoom(opts?: { defaultJoinRole?: "listener" | "dj" }) {
  const host = await prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });
  const code = generateRoomCode(6, () => randomBytes(1)[0]! / 256);
  const room = await prisma.room.create({
    data: {
      code,
      status: "open",
      defaultJoinRole: opts?.defaultJoinRole ?? "listener",
      originalHostUserId: host.id,
    },
  });
  return { host, room, code: room.code };
}

async function seatGuest(roomId: string, displayName = "Guest Ada") {
  const rawToken = createGuestToken();
  const participant = await prisma.roomParticipant.create({
    data: {
      roomId,
      displayName,
      role: "listener",
      guestTokenHash: hashGuestToken(rawToken),
    },
  });
  const setCookie = await serializeGuestTokenCookie(rawToken);
  const parsed = parseString(setCookie)!;
  return {
    participant,
    cookie: `${parsed.name}=${parsed.value}`,
    rawToken,
  };
}

async function createTrack(opts: { title: string; withAudio: boolean }) {
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const artist = await prisma.artist.create({
    data: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
  });
  const track = await prisma.track.create({
    data: {
      title: opts.title,
      externalId: `ext-${suffix}`,
      serviceId: service.id,
      artistId: artist.id,
    },
  });
  if (opts.withAudio) {
    await prisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: `audio/${suffix}.flac`,
        format: "flac",
      },
    });
  }
  return track;
}

function auditionArgs(code: string, cookie: string | null, trackId: string) {
  const request = new Request(`http://localhost/api/rooms/${code}/audition`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ trackId }),
  });
  return { request, params: { roomCode: code } };
}

function searchArgs(code: string, cookie: string | null, q: string) {
  const request = new Request(
    `http://localhost/api/rooms/${code}/search?q=${encodeURIComponent(q)}&type=tracks`,
    {
      method: "GET",
      headers: cookie ? { cookie } : {},
    },
  );
  return { request, params: { roomCode: code } };
}

async function statusOf(response: Response | unknown) {
  if (response instanceof Response) return response.status;
  return (response as { init?: { status?: number } }).init?.status ?? 200;
}

async function jsonOf(response: Response | unknown) {
  if (response instanceof Response) return response.json();
  return (response as { data?: unknown }).data;
}

describe("party room audition grant authz (route)", () => {
  beforeEach(() => {
    resetAuditionGrants();
    resetPartyRoomRateLimits();
  });

  test("rejects anonymous callers without a participant seat", async () => {
    const { code } = await seedOpenRoom();
    const track = await createTrack({ title: "Anon Deny", withAudio: true });
    const response = await auditionAction(auditionArgs(code, null, track.id));
    expect(await statusOf(response)).toBe(401);
  });

  test("rejects tracks without audio even for seated guests", async () => {
    const { room, code } = await seedOpenRoom();
    const { cookie } = await seatGuest(room.id);
    const track = await createTrack({ title: "No Audio Track", withAudio: false });
    const response = await auditionAction(auditionArgs(code, cookie, track.id));
    expect(await statusOf(response)).toBe(404);
  });

  test("grants audition for seated listener with has-audio track", async () => {
    const { room, code } = await seedOpenRoom();
    const { cookie } = await seatGuest(room.id);
    const track = await createTrack({ title: "Audition Ok", withAudio: true });
    const response = await auditionAction(auditionArgs(code, cookie, track.id));
    expect(await statusOf(response)).toBe(200);
    const body = (await jsonOf(response)) as { ok?: boolean; audioUrl?: string };
    expect(body?.ok).toBe(true);
    expect(body?.audioUrl).toMatch(/^\/resources\/audition\//);
  });
});

describe("party room search gate (route)", () => {
  beforeEach(() => {
    resetPartyRoomRateLimits();
  });

  test("rejects search without participant seat", async () => {
    const { code } = await seedOpenRoom();
    const response = await searchLoader(searchArgs(code, null, "test"));
    expect(await statusOf(response)).toBe(401);
  });

  test("seated guest can search and only sees has-audio tracks", async () => {
    const marker = `RouteSearch${Date.now()}`;
    const { room, code } = await seedOpenRoom();
    const { cookie } = await seatGuest(room.id);
    await createTrack({ title: `${marker} Yes`, withAudio: true });
    await createTrack({ title: `${marker} No`, withAudio: false });

    const response = await searchLoader(searchArgs(code, cookie, marker));
    expect(await statusOf(response)).toBe(200);
    const body = (await jsonOf(response)) as {
      results?: Array<{ type: string; title?: string }>;
    };
    const titles = body?.results?.filter((r) => r.type === "track").map((r) => r.title ?? "") ?? [];
    expect(titles.some((t) => t.includes("Yes"))).toBe(true);
    expect(titles.some((t) => t.includes("No"))).toBe(false);
  });
});
