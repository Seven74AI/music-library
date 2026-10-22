import { beforeEach, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { hashGuestToken } from "./guest-token.server.ts";
import { createRoom, joinRoom, PartyRoomError } from "./party-room.server.ts";
import { addTrackToQueue } from "./queue.server.ts";
import { assertRoomSpeakerTrackAccess } from "./speaker-audio.server.ts";

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

async function makeUser(name = "Host") {
  return prisma.user.create({
    data: {
      ...createUser(),
      name,
      roles: { connect: { name: "user" } },
    },
  });
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
      objectKey: `audio/tracks/local/${track.id}.mp3`,
      format: "mp3",
    },
  });
  return track;
}

beforeEach(cleanup);

test("assertRoomSpeakerTrackAccess allows current host for queued track", async () => {
  const user = await makeUser();
  const track = await makeTrackWithAudio("Speaker Track");
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

  await expect(
    assertRoomSpeakerTrackAccess({ type: "user", userId: user.id }, track.id),
  ).resolves.toMatchObject({ roomId: room.id });
});

test("assertRoomSpeakerTrackAccess rejects non-host participants", async () => {
  const host = await makeUser("Host");
  const track = await makeTrackWithAudio("Speaker Track 2");
  const room = await createRoom({
    userId: host.id,
    displayName: "Host",
    defaultJoinRole: "dj",
  });
  await addTrackToQueue({
    roomId: room.id,
    actor: { type: "user", userId: host.id },
    trackId: track.id,
  });
  const guest = await joinRoom({
    code: room.code,
    actor: { type: "guest", displayName: "Walker" },
  });

  await expect(
    assertRoomSpeakerTrackAccess({ type: "guest", guestToken: guest.guestToken! }, track.id),
  ).rejects.toBeInstanceOf(PartyRoomError);

  expect(guest.participant.guestTokenHash).toBe(hashGuestToken(guest.guestToken!));
});
