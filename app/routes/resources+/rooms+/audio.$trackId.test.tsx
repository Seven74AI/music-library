import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./audio.$trackId.tsx";

vi.mock("#app/features/party-room/request.server.ts", () => ({
  resolveActor: vi.fn(),
  partyRoomErrorResponse: vi.fn(),
}));

vi.mock("#app/features/party-room/speaker-audio.server.ts", () => ({
  assertRoomSpeakerTrackAccess: vi.fn().mockResolvedValue({ roomId: "room-1" }),
}));

const { resolveActor } = await import("#app/features/party-room/request.server.ts");

const fixtureTrackDirs = new Set<string>();

afterAll(() => {
  for (const dir of fixtureTrackDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}, 30_000);

function createAudioFixture(objectKey: string) {
  const fixturePath = join(process.cwd(), "tests", "fixtures", "uploaded", objectKey);
  const dir = fixturePath.substring(0, fixturePath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fixturePath, Buffer.from([0xff, 0xfb, 0x90, 0x00, ...Array(40).fill(0)]));
  const trackId = objectKey.split("/")[3];
  if (trackId) {
    fixtureTrackDirs.add(
      join(process.cwd(), "tests", "fixtures", "uploaded", "audio", "tracks", "local", trackId),
    );
  }
}

test("room speaker audio uses private no-store cache control", async () => {
  const suffix = `${Date.now()}`;
  const user = await prisma.user.create({
    data: { ...createUser(), username: `room-audio-${suffix}` },
  });
  const service = await prisma.service.create({
    data: {
      name: `room-audio-svc-${suffix}`,
      displayName: "Local",
      baseUrl: "https://example.com",
    },
  });
  const track = await prisma.track.create({
    data: {
      title: "Room track",
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
  createAudioFixture(`audio/tracks/local/${track.id}.mp3`);

  vi.mocked(resolveActor).mockResolvedValue({ type: "user", userId: user.id });

  const response = await loader({
    request: new Request(`https://localhost/resources/rooms/audio/${track.id}`),
    params: { trackId: track.id },
    context: {},
  } as never);

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
