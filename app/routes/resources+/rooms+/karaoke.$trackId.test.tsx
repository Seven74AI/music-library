import { beforeEach, expect, test, vi } from "vitest";
import {
  createRoom,
  joinRoom,
  PartyRoomError,
} from "#app/features/party-room/party-room.server.ts";
import { addTrackToQueue } from "#app/features/party-room/queue.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./karaoke.$trackId.tsx";

vi.mock("#app/features/party-room/request.server.ts", () => ({
  resolveActor: vi.fn(),
  partyRoomErrorResponse: vi.fn((error: unknown) => {
    const status = error instanceof PartyRoomError ? error.status : 500;
    return new Response("err", { status });
  }),
}));

const { resolveActor } = await import("#app/features/party-room/request.server.ts");

const LINES = [
  [
    { word: "Hello", start: 1, end: 1.5 },
    { word: "world", start: 1.5, end: 2 },
  ],
  [],
  [{ word: "Bye", start: 5, end: 6 }],
];

beforeEach(async () => {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
});

async function makeTrack(opts: {
  status?: "draft" | "ready";
  karaoke?: boolean;
  linesJson?: string;
}) {
  const { status = "ready", karaoke = true, linesJson = JSON.stringify(LINES) } = opts;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: { ...createUser(), username: `room-karaoke-${suffix}` },
  });
  const service = await prisma.service.create({
    data: {
      name: `room-karaoke-svc-${suffix}`,
      displayName: "Local",
      baseUrl: "https://e.com",
    },
  });
  const track = await prisma.track.create({
    data: {
      title: "Room karaoke track",
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `A ${suffix}`, normalizedName: `a ${suffix}` },
      },
    },
  });
  await prisma.trackAudioFile.create({
    data: {
      trackId: track.id,
      serviceId: service.id,
      objectKey: `audio/tracks/remote/${track.id}.mp3`,
      format: "mp3",
    },
  });
  let versionId: string | null = null;
  if (karaoke) {
    const version = await prisma.trackKaraokeVersion.create({
      data: {
        trackId: track.id,
        language: "en",
        source: "paste",
        lyricsText: "x",
        lines: linesJson,
        status,
      },
    });
    versionId = version.id;
    await prisma.trackKaraoke.create({
      data: { trackId: track.id, currentVersionId: version.id },
    });
  }
  const room = await createRoom({
    userId: user.id,
    displayName: "Host",
    defaultJoinRole: "listener",
  });
  await addTrackToQueue({
    roomId: room.id,
    actor: { type: "user", userId: user.id },
    trackId: track.id,
  });
  vi.mocked(resolveActor).mockResolvedValue({ type: "user", userId: user.id });
  return { ...track, room, versionId };
}

function call(trackId: string) {
  return loader({
    request: new Request(`https://localhost/resources/rooms/karaoke/${trackId}`),
    params: { trackId },
    context: {},
  } as never);
}

test("rejects a non-host member via the real speaker grant", async () => {
  const track = await makeTrack({});
  const guest = await joinRoom({
    code: track.room.code,
    actor: { type: "guest", displayName: "Walker" },
  });
  vi.mocked(resolveActor).mockResolvedValue({
    type: "guest",
    guestToken: guest.guestToken!,
  });
  const response = await call(track.id);
  expect(response.status).toBe(403);
});

test("host gets versionId + parsed lines for a ready version", async () => {
  const track = await makeTrack({});
  const response = await call(track.id);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body).toEqual({ versionId: track.versionId, lines: LINES });
});

test("404 for a draft version", async () => {
  const track = await makeTrack({ status: "draft" });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});

test("404 when track has no karaoke", async () => {
  const track = await makeTrack({ karaoke: false });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});

test("404 when stored lines are invalid", async () => {
  const track = await makeTrack({ linesJson: "not json" });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});
