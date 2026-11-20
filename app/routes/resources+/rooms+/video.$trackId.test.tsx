import { beforeEach, expect, test, vi } from "vitest";
import {
  createRoom,
  joinRoom,
  PartyRoomError,
} from "#app/features/party-room/party-room.server.ts";
import { addTrackToQueue } from "#app/features/party-room/queue.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./video.$trackId.tsx";

vi.mock("#app/features/party-room/request.server.ts", () => ({
  resolveActor: vi.fn(),
  partyRoomErrorResponse: vi.fn((error: unknown) => {
    const status = error instanceof PartyRoomError ? error.status : 500;
    return new Response("err", { status });
  }),
}));

vi.mock("#app/utils/storage.server.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#app/utils/storage.server.ts")>()),
  getFileUrl: vi.fn(),
  getStorageObjectStream: vi.fn(async (_key: string, request: Request) => {
    const range = request.headers.get("Range");
    if (range === "bytes=999-") return { status: 416, fileSize: 10 };
    if (range) {
      return {
        status: 206,
        body: new Response("abc").body,
        contentType: "video/mp4",
        contentLength: 3,
        contentRange: "bytes 0-2/10",
      };
    }
    return {
      status: 200,
      body: new Response("0123456789").body,
      contentType: "video/mp4",
      contentLength: 10,
      contentRange: null,
    };
  }),
}));

const { resolveActor } = await import("#app/features/party-room/request.server.ts");

beforeEach(async () => {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
});

async function makeTrack(opts: {
  status?: "draft" | "ready";
  video?: boolean;
  karaoke?: boolean;
  objectKey?: (trackId: string) => string;
}) {
  const { status = "ready", video = true, karaoke = true } = opts;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: { ...createUser(), username: `room-video-${suffix}` },
  });
  const service = await prisma.service.create({
    data: {
      name: `room-video-svc-${suffix}`,
      displayName: "Local",
      baseUrl: "https://e.com",
    },
  });
  const track = await prisma.track.create({
    data: {
      title: "Room video track",
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
  let videoFileId: string | null = null;
  if (video) {
    const v = await prisma.trackVideoFile.create({
      data: {
        trackId: track.id,
        serviceId: service.id,
        objectKey: opts.objectKey?.(track.id) ?? `video/tracks/remote/${track.id}.mp4`,
        mimeType: "video/mp4",
        format: "mp4",
      },
    });
    videoFileId = v.id;
  }
  if (karaoke) {
    const version = await prisma.trackKaraokeVersion.create({
      data: {
        trackId: track.id,
        language: "en",
        source: "paste",
        lyricsText: "x",
        lines: "[]",
        status,
        videoFileId,
      },
    });
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
  return { ...track, room };
}

function call(trackId: string, headers: Record<string, string> = {}) {
  return loader({
    request: new Request(`https://localhost/resources/rooms/video/${trackId}`, {
      headers,
    }),
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

test("real grant: current host of a room with the track queued gets 200", async () => {
  const track = await makeTrack({});
  const response = await call(track.id);
  expect(response.status).toBe(200);
});

test("404 for a non-video object key", async () => {
  const track = await makeTrack({
    objectKey: (id) => `audio/tracks/remote/${id}.mp3`,
  });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});

test("serves a ready karaoke video in full with private no-store", async () => {
  const track = await makeTrack({});
  const response = await call(track.id);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("video/mp4");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

test("serves Range as 206 and 416", async () => {
  const track = await makeTrack({});
  const partial = await call(track.id, { Range: "bytes=0-2" });
  expect(partial.status).toBe(206);
  expect(partial.headers.get("Content-Range")).toBe("bytes 0-2/10");
  const bad = await call(track.id, { Range: "bytes=999-" });
  expect(bad.status).toBe(416);
});

test("404 for a draft version", async () => {
  const track = await makeTrack({ status: "draft" });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});

test("404 when ready version has no video", async () => {
  const track = await makeTrack({ video: false });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});

test("404 when track has no karaoke", async () => {
  const track = await makeTrack({ karaoke: false });
  await expect(call(track.id)).rejects.toMatchObject({ status: 404 });
});
