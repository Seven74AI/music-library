import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { createRoom, joinRoom } from "./party-room.server.ts";
import {
  addPlaylistToQueue,
  addTrackToQueue,
  removeQueueItem,
  reorderUpcoming,
  setTransport,
  skipNext,
  skipToIndex,
} from "./queue.server.ts";
import {
  publishRoomEvent,
  resetRoomSseConnections,
  roomSubscriberCount,
  subscribeRoomEvents,
} from "./sse.server.ts";

async function cleanup() {
  await prisma.roomPlayEvent.deleteMany();
  await prisma.roomQueueItem.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.room.deleteMany();
  await prisma.userPlaylistTrack.deleteMany();
  await prisma.userPlaylist.deleteMany();
  await prisma.trackAudioFile.deleteMany();
  await prisma.track.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.user.deleteMany();
  resetRoomSseConnections();
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

async function makeTrackNoAudio(title: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
}

describe("party-room queue mutations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  test("concurrent adds from two DJs get unique dense positions", async () => {
    const host = await makeUser();
    const dj = await makeUser("DJ");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "dj",
    });
    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: dj.id },
    });
    const trackA = await makeTrackWithAudio("A");
    const trackB = await makeTrackWithAudio("B");

    await Promise.all([
      addTrackToQueue({
        roomId: room.id,
        actor: { type: "user", userId: host.id },
        trackId: trackA.id,
      }),
      addTrackToQueue({
        roomId: room.id,
        actor: { type: "user", userId: dj.id },
        trackId: trackB.id,
      }),
    ]);

    const items = await prisma.roomQueueItem.findMany({
      where: { roomId: room.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.position)).toEqual([0, 1]);

    const skipped = await skipNext({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });
    expect(skipped?.currentIndex).toBe(1);
    expect(skipped?.queue.find((row) => row.position === skipped.currentIndex)?.trackId).toBe(
      items[1]!.trackId,
    );
  });

  test("Host/DJ can add tracks with audio; Listener cannot", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const track = await makeTrackWithAudio("Song");

    const snapshot = await addTrackToQueue({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      trackId: track.id,
    });
    expect(snapshot?.queue).toHaveLength(1);
    expect(snapshot?.roomVersion).toBeGreaterThan(room.roomVersion);

    const listener = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Listener" },
    });
    await expect(
      addTrackToQueue({
        roomId: room.id,
        actor: { type: "guest", guestToken: listener.guestToken! },
        trackId: track.id,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const noAudio = await makeTrackNoAudio("Silent");
    await expect(
      addTrackToQueue({
        roomId: room.id,
        actor: { type: "user", userId: host.id },
        trackId: noAudio.id,
      }),
    ).rejects.toMatchObject({ code: "track_no_audio" });
  });

  test("Host can bulk-add playlist tracks respecting cap and audio filter", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const t1 = await makeTrackWithAudio("A");
    const t2 = await makeTrackWithAudio("B");
    const t3 = await makeTrackNoAudio("C");
    const playlist = await prisma.userPlaylist.create({
      data: {
        title: "Party Mix",
        ownerId: host.id,
        tracks: {
          create: [
            { trackId: t1.id, position: 0 },
            { trackId: t2.id, position: 1 },
            { trackId: t3.id, position: 2 },
          ],
        },
      },
    });

    const result = await addPlaylistToQueue({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      playlistId: playlist.id,
    });
    expect(result.addedCount).toBe(2);
    expect(result.skippedNoAudio).toBe(1);
    expect(result.snapshot?.queue.map((q) => q.trackId)).toEqual([t1.id, t2.id]);
  });

  test("remove-own works for Listener; history rows are locked", async () => {
    const host = await makeUser();
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "listener",
    });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Listener" },
    });
    // Promote temporarily via host adding then... actually listener can't add.
    // Use host to add as guest's id? Can't. Promote guest to DJ via update.
    await prisma.roomParticipant.update({
      where: { id: guest.participant.id },
      data: { role: "dj" },
    });
    const trackA = await makeTrackWithAudio("A");
    const trackB = await makeTrackWithAudio("B");
    await addTrackToQueue({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
      trackId: trackA.id,
    });
    await addTrackToQueue({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
      trackId: trackB.id,
    });
    // Demote back to listener — remove-own still works
    await prisma.roomParticipant.update({
      where: { id: guest.participant.id },
      data: { role: "listener" },
    });

    const items = await prisma.roomQueueItem.findMany({
      where: { roomId: room.id },
      orderBy: { position: "asc" },
    });
    expect(items).toHaveLength(2);

    // Advance pointer so first item is history
    await prisma.room.update({
      where: { id: room.id },
      data: { currentIndex: 0 },
    });
    // position 0 is current (not upcoming — isUpcoming is position > currentIndex)
    // So item 0 is not removable; item 1 is upcoming and own
    await expect(
      removeQueueItem({
        roomId: room.id,
        actor: { type: "guest", guestToken: guest.guestToken! },
        queueItemId: items[0]!.id,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const after = await removeQueueItem({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
      queueItemId: items[1]!.id,
    });
    expect(after?.queue).toHaveLength(1);
    expect(after?.queue[0]?.trackId).toBe(trackA.id);
  });

  test("reorder upcoming and host transport / jump", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const tracks = await Promise.all([
      makeTrackWithAudio("1"),
      makeTrackWithAudio("2"),
      makeTrackWithAudio("3"),
    ]);
    for (const t of tracks) {
      await addTrackToQueue({
        roomId: room.id,
        actor: { type: "user", userId: host.id },
        trackId: t.id,
      });
    }

    const items = await prisma.roomQueueItem.findMany({
      where: { roomId: room.id },
      orderBy: { position: "asc" },
    });
    // currentIndex 0 → upcoming are positions 1,2
    const reordered = await reorderUpcoming({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      orderedUpcomingIds: [items[2]!.id, items[1]!.id],
    });
    expect(reordered?.queue.map((q) => q.trackId)).toEqual([
      tracks[0]!.id,
      tracks[2]!.id,
      tracks[1]!.id,
    ]);

    const playing = await setTransport({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      isPlaying: true,
    });
    expect(playing?.isPlaying).toBe(true);

    const jumped = await skipToIndex({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      index: 2,
    });
    expect(jumped?.currentIndex).toBe(2);
    // History above pointer remains
    expect(jumped?.queue.map((q) => q.position)).toEqual([0, 1, 2]);
  });

  test("skipNext advances mid-queue and stops at the last track instead of staying playing", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const tracks = await Promise.all([makeTrackWithAudio("1"), makeTrackWithAudio("2")]);
    for (const t of tracks) {
      await addTrackToQueue({
        roomId: room.id,
        actor: { type: "user", userId: host.id },
        trackId: t.id,
      });
    }

    const mid = await skipNext({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });
    expect(mid?.currentIndex).toBe(1);
    expect(mid?.isPlaying).toBe(true);

    const ended = await skipNext({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });
    expect(ended?.currentIndex).toBe(1);
    expect(ended?.isPlaying).toBe(false);
  });
});

describe("party-room SSE fan-out", () => {
  beforeEach(() => {
    resetRoomSseConnections();
  });

  test("publishRoomEvent fans out to all subscribers", () => {
    const chunks: string[] = [];
    const makeController = () =>
      ({
        enqueue(chunk: Uint8Array) {
          chunks.push(new TextDecoder().decode(chunk));
        },
      }) as ReadableStreamDefaultController<Uint8Array>;

    const c1 = makeController();
    const c2 = makeController();
    const unsub1 = subscribeRoomEvents("room-1", c1);
    const unsub2 = subscribeRoomEvents("room-1", c2);
    expect(roomSubscriberCount("room-1")).toBe(2);

    publishRoomEvent("room-1", { type: "room_snapshot", roomVersion: 3 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('"roomVersion":3');
    expect(chunks[1]).toContain('"roomVersion":3');

    unsub1();
    unsub2();
    expect(roomSubscriberCount("room-1")).toBe(0);
  });
});
