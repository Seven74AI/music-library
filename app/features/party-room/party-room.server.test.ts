import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  EMPTY_ROOM_TTL_MS,
  NON_SPEAKER_AWAY_MS,
  MAX_PARTICIPANTS,
  ROOM_ROLE,
  SPEAKER_SILENCE_GRACE_MS,
} from "./constants.ts";
import { hashGuestToken } from "./guest-token.server.ts";
import {
  becomeHost,
  createRoom,
  endRoom,
  getRoomSnapshot,
  heartbeat,
  joinRoom,
  kickParticipant,
  leaveRoom,
  PartyRoomError,
  reclaimHost,
  setDefaultJoinRole,
  sweepExpiredEmptyRooms,
} from "./party-room.server.ts";
import { addTrackToQueue } from "./queue.server.ts";
import { resetRoomSseConnections } from "./sse.server.ts";

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

async function makeUser(name = "Host User") {
  return prisma.user.create({
    data: {
      ...createUser(),
      name,
      roles: { connect: { name: "user" } },
    },
  });
}

function reclaimSeatId(room: object): string | null {
  const value = (room as { reclaimParticipantId?: string | null }).reclaimParticipantId;
  return typeof value === "string" ? value : null;
}

async function loadRoom(roomId: string) {
  return prisma.room.findUniqueOrThrow({ where: { id: roomId } });
}

async function agePastGrace(participantId: string) {
  await prisma.roomParticipant.update({
    where: { id: participantId },
    data: { lastSeenAt: new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000) },
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
      serviceId: track.serviceId,
      objectKey: `audio/tracks/local/${track.id}.mp3`,
      format: "mp3",
    },
  });
  return track;
}

describe("party-room lifecycle", () => {
  beforeEach(async () => {
    await cleanup();
  });

  test("createRoom makes Host + empty queue + unique code", async () => {
    const user = await makeUser("Kody");
    const room = await createRoom({
      userId: user.id,
      displayName: "Kody",
      defaultJoinRole: "dj",
    });

    expect(room.code).toHaveLength(6);
    expect(room.status).toBe("open");
    expect(room.defaultJoinRole).toBe("dj");
    expect(room.currentIndex).toBe(0);
    expect(room.queueItems).toHaveLength(0);
    expect(room.participants).toHaveLength(1);
    expect(room.participants[0]?.role).toBe(ROOM_ROLE.host);
    expect(room.currentHostParticipantId).toBe(room.participants[0]?.id);
    expect(reclaimSeatId(room)).toBe(room.participants[0]?.id);
  });

  test("creator cannot open a second active room", async () => {
    const user = await makeUser();
    const first = await createRoom({ userId: user.id, displayName: "Host" });
    await expect(createRoom({ userId: user.id, displayName: "Host" })).rejects.toMatchObject({
      code: "already_in_room",
    });

    await leaveRoom({
      roomId: first.id,
      actor: { type: "user", userId: user.id },
    });

    const second = await createRoom({ userId: user.id, displayName: "Host" });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("open");

    const oldRoom = await prisma.room.findUniqueOrThrow({ where: { id: first.id } });
    expect(oldRoom.status).toBe("open");
  });

  test("smart join links authenticated users and creates guest seats", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({ userId: host.id, displayName: "Host" });

    const member = await makeUser("Alice");
    const linked = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Alice" },
    });
    expect(linked.participant.userId).toBe(member.id);
    expect(linked.participant.role).toBe(ROOM_ROLE.listener);
    expect(linked.guestToken).toBeNull();

    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Bob" },
    });
    expect(guest.participant.userId).toBeNull();
    expect(guest.participant.guestTokenHash).toBe(hashGuestToken(guest.guestToken!));
    expect(guest.participant.displayName).toBe("Bob");
    expect(guest.participant.role).toBe(ROOM_ROLE.listener);
  });

  test("logging in claims the open guest seat instead of minting a second one", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "dj",
    });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Walkup DJ" },
    });
    expect(guest.participant.role).toBe(ROOM_ROLE.dj);

    const account = await makeUser("Walkup");
    const claimed = await joinRoom({
      code: room.code,
      actor: {
        type: "user",
        userId: account.id,
        displayName: "Account Name",
        guestToken: guest.guestToken,
      },
    });

    expect(claimed.participant.id).toBe(guest.participant.id);
    expect(claimed.participant.userId).toBe(account.id);
    expect(claimed.participant.guestTokenHash).toBeNull();
    expect(claimed.participant.role).toBe(ROOM_ROLE.dj);
    expect(claimed.participant.displayName).toBe("Walkup DJ");
    expect(claimed.guestToken).toBeNull();

    const seated = await prisma.roomParticipant.findMany({
      where: { roomId: room.id, leftAt: null },
      select: { id: true, userId: true, guestTokenHash: true },
    });
    expect(seated).toHaveLength(2);
    expect(seated.map((row) => row.id).sort()).toEqual(
      [room.participants[0]!.id, guest.participant.id].sort(),
    );
  });

  test("login can claim a guest host seat in a full room", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Speaker" },
    });
    await agePastGrace(room.participants[0]!.id);
    await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });
    await leaveRoom({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(guest.participant.id);

    for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) {
      await joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: `G${String(i).padStart(2, "0")}` },
      });
    }
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id, leftAt: null } })).toBe(
      MAX_PARTICIPANTS,
    );

    const account = await makeUser("Now Signed In");
    const claimed = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: account.id, guestToken: guest.guestToken },
    });

    const after = await loadRoom(room.id);
    expect(claimed.participant.id).toBe(guest.participant.id);
    expect(claimed.participant.role).toBe(ROOM_ROLE.host);
    expect(after.currentHostParticipantId).toBe(guest.participant.id);
    expect(reclaimSeatId(after)).toBe(guest.participant.id);
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id, leftAt: null } })).toBe(
      MAX_PARTICIPANTS,
    );
  }, 30_000);

  test("defaultJoinRole dj promotes new joiners to DJ", async () => {
    const host = await makeUser();
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "dj",
    });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "DJ Walkup" },
    });
    expect(guest.participant.role).toBe(ROOM_ROLE.dj);
  });

  test("rejects invalid guest display names", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    await expect(
      joinRoom({ code: room.code, actor: { type: "guest", displayName: "" } }),
    ).rejects.toMatchObject({ code: "invalid_display_name" });
    await expect(
      joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: "x".repeat(25) },
      }),
    ).rejects.toMatchObject({ code: "invalid_display_name" });
  });

  // 49 sequential joins exceed Vitest's 5s default when the suite is under CI load.
  test("enforces max participants", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });

    // Fill remaining seats (host already counts as 1)
    for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) {
      await joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: `G${String(i).padStart(2, "0")}` },
      });
    }

    await expect(
      joinRoom({ code: room.code, actor: { type: "guest", displayName: "Overflow" } }),
    ).rejects.toMatchObject({ code: "room_full" });
  }, 30_000);

  test("guest joining a second room vacates the previous open seat", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });

    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Walkup" },
    });

    const moved = await joinRoom({
      code: roomB.code,
      actor: {
        type: "guest",
        displayName: "Walkup",
        guestToken: guest.guestToken,
      },
    });

    expect(moved.roomId).toBe(roomB.id);
    expect(moved.participant.leftAt).toBeNull();

    const stillInA = await prisma.roomParticipant.findFirst({
      where: { id: guest.participant.id },
    });
    expect(stillInA?.leftAt).not.toBeNull();

    const activeA = await prisma.roomParticipant.count({
      where: { roomId: roomA.id, leftAt: null },
    });
    expect(activeA).toBe(1);

    const activeB = await prisma.roomParticipant.count({
      where: { roomId: roomB.id, leftAt: null },
    });
    expect(activeB).toBe(2);
  });

  test("last guest moving to another room starts empty-room TTL on the old room", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });

    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Last One" },
    });
    await leaveRoom({
      roomId: roomA.id,
      actor: { type: "user", userId: hostA.id },
    });

    await joinRoom({
      code: roomB.code,
      actor: {
        type: "guest",
        displayName: "Last One",
        guestToken: guest.guestToken,
      },
    });

    const vacated = await prisma.room.findUniqueOrThrow({ where: { id: roomA.id } });
    expect(vacated.status).toBe("open");
    expect(vacated.emptySince).not.toBeNull();
    expect(vacated.currentHostParticipantId).toBeNull();
  });

  test("leave and end room; codes stop working for ended rooms", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Guest" },
    });

    await leaveRoom({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });

    const remaining = await prisma.roomParticipant.count({
      where: { roomId: room.id, leftAt: null },
    });
    expect(remaining).toBe(1);

    await endRoom({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });

    const ended = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).not.toBeNull();

    await expect(
      joinRoom({ code: room.code, actor: { type: "guest", displayName: "Late" } }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  test("host can set defaultJoinRole", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const snapshot = await setDefaultJoinRole({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      defaultJoinRole: "dj",
    });
    expect(snapshot?.defaultJoinRole).toBe("dj");
  });

  test("becomeHost after grace; reclaimHost for original host", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({ userId: hostUser.id, displayName: "Original" });
    const djJoin = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "StandIn" },
    });

    // Promote guest to dj via join default — change default and re-check become host grace
    await expect(
      becomeHost({
        roomId: room.id,
        actor: { type: "guest", guestToken: djJoin.guestToken! },
      }),
    ).rejects.toMatchObject({ code: "host_still_present" });

    // Speaker must be Away under the 30s silence rule before takeover.
    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000) },
    });

    const after = await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: djJoin.guestToken! },
      now: new Date(),
    });
    expect(after?.currentHostParticipantId).toBe(djJoin.participant.id);
    expect(after?.participants.find((p) => p.id === djJoin.participant.id)?.role).toBe(
      ROOM_ROLE.host,
    );
    // Become host does not move the pass. The seated creator still holds it.
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(room.participants[0]?.id);

    const reclaimed = await reclaimHost({
      roomId: room.id,
      actor: { type: "user", userId: hostUser.id },
    });
    expect(reclaimed?.currentHostParticipantId).toBe(room.participants[0]?.id);
    expect(reclaimed?.isPlaying).toBe(false);
  });

  test("creator leave transfers reclaim to the signed-in current host", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({
      userId: hostUser.id,
      displayName: "Original",
      defaultJoinRole: "listener",
    });
    const creatorSeatId = room.participants[0]!.id;

    const member = await makeUser("Alice");
    const alice = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Alice" },
    });

    await agePastGrace(creatorSeatId);
    await becomeHost({
      roomId: room.id,
      actor: { type: "user", userId: member.id },
    });
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(creatorSeatId);

    const bystander = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Listener" },
    });
    await leaveRoom({
      roomId: room.id,
      actor: { type: "guest", guestToken: bystander.guestToken! },
    });
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(creatorSeatId);

    await leaveRoom({
      roomId: room.id,
      actor: { type: "user", userId: hostUser.id },
    });

    const afterLeave = await loadRoom(room.id);
    expect(afterLeave.status).toBe("open");
    expect(afterLeave.endedAt).toBeNull();
    expect(afterLeave.currentHostParticipantId).toBe(alice.participant.id);
    expect(reclaimSeatId(afterLeave)).toBe(alice.participant.id);

    await expect(
      reclaimHost({ roomId: room.id, actor: { type: "user", userId: hostUser.id } }),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const standIn = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "StandIn" },
    });
    await agePastGrace(alice.participant.id);
    await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: standIn.guestToken! },
    });
    await prisma.room.update({
      where: { id: room.id },
      data: { isPlaying: true },
    });

    const reclaimed = await reclaimHost({
      roomId: room.id,
      actor: { type: "user", userId: member.id },
    });
    expect(reclaimed?.currentHostParticipantId).toBe(alice.participant.id);
    expect(reclaimed?.isPlaying).toBe(false);
    expect(reclaimed?.participants.find((p) => p.id === standIn.participant.id)?.role).toBe(
      ROOM_ROLE.dj,
    );

    const back = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: hostUser.id, displayName: "Original" },
    });
    expect(back.participant.id).toBe(creatorSeatId);
    expect(back.participant.role).toBe(ROOM_ROLE.listener);
    expect(back.participant.leftAt).toBeNull();
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(alice.participant.id);
    await expect(
      reclaimHost({ roomId: room.id, actor: { type: "user", userId: hostUser.id } }),
    ).rejects.toMatchObject({ code: "not_original_host" });
  });

  test("guest reclaim holder can reclaim during playback; a new guest token cannot", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({
      userId: hostUser.id,
      displayName: "Original",
      defaultJoinRole: "listener",
    });
    const creatorSeatId = room.participants[0]!.id;

    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Speaker" },
    });

    await agePastGrace(creatorSeatId);
    await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });
    await leaveRoom({
      roomId: room.id,
      actor: { type: "user", userId: hostUser.id },
    });

    const afterLeave = await loadRoom(room.id);
    expect(afterLeave.status).toBe("open");
    expect(afterLeave.endedAt).toBeNull();
    expect(afterLeave.currentHostParticipantId).toBe(guest.participant.id);
    expect(reclaimSeatId(afterLeave)).toBe(guest.participant.id);

    const otherBrowser = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Other Phone" },
    });
    expect(otherBrowser.participant.id).not.toBe(guest.participant.id);
    expect(otherBrowser.guestToken).not.toBe(guest.guestToken);
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(guest.participant.id);
    await expect(
      reclaimHost({
        roomId: room.id,
        actor: { type: "guest", guestToken: otherBrowser.guestToken! },
      }),
    ).rejects.toMatchObject({ code: "not_original_host" });

    await agePastGrace(guest.participant.id);
    await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: otherBrowser.guestToken! },
    });
    await prisma.room.update({
      where: { id: room.id },
      data: { isPlaying: true },
    });

    const reclaimed = await reclaimHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });
    expect(reclaimed?.isPlaying).toBe(false);
    expect(reclaimed?.currentHostParticipantId).toBe(guest.participant.id);
    expect(reclaimed?.participants.find((p) => p.id === otherBrowser.participant.id)?.role).toBe(
      ROOM_ROLE.dj,
    );
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(guest.participant.id);

    await setDefaultJoinRole({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
      defaultJoinRole: "dj",
    });
    const back = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: hostUser.id, displayName: "Original" },
    });
    expect(back.participant.role).toBe(ROOM_ROLE.dj);
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(guest.participant.id);
    await expect(
      reclaimHost({ roomId: room.id, actor: { type: "user", userId: hostUser.id } }),
    ).rejects.toMatchObject({ code: "not_original_host" });
  });

  test("rejoin after leave uses the room current defaultJoinRole", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "dj",
    });
    const creatorSeatId = room.participants[0]!.id;

    const member = await makeUser("Sam");
    const first = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Sam" },
    });
    expect(first.participant.role).toBe(ROOM_ROLE.dj);

    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Walkup" },
    });
    expect(guest.participant.role).toBe(ROOM_ROLE.dj);

    await setDefaultJoinRole({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      defaultJoinRole: "listener",
    });
    await leaveRoom({ roomId: room.id, actor: { type: "user", userId: member.id } });
    await leaveRoom({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });

    const memberBack = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Sam" },
    });
    expect(memberBack.participant.id).toBe(first.participant.id);
    expect(memberBack.participant.role).toBe(ROOM_ROLE.listener);
    expect(memberBack.participant.leftAt).toBeNull();

    const guestBack = await joinRoom({
      code: room.code,
      actor: {
        type: "guest",
        displayName: "Walkup",
        guestToken: guest.guestToken,
      },
    });
    expect(guestBack.participant.id).toBe(guest.participant.id);
    expect(guestBack.participant.role).toBe(ROOM_ROLE.listener);

    const freshBrowser = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "New Device" },
    });
    expect(freshBrowser.participant.id).not.toBe(guest.participant.id);
    expect(freshBrowser.participant.role).toBe(ROOM_ROLE.listener);
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(creatorSeatId);
  });

  test("guest host rejoin while still seated keeps host role and speaker pointer", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({
      userId: hostUser.id,
      displayName: "Original",
      defaultJoinRole: "listener",
    });
    const creatorSeatId = room.participants[0]!.id;

    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Speaker" },
    });

    await agePastGrace(creatorSeatId);
    await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });

    const again = await joinRoom({
      code: room.code,
      actor: {
        type: "guest",
        displayName: "Speaker",
        guestToken: guest.guestToken,
      },
    });

    expect(again.participant.id).toBe(guest.participant.id);
    expect(again.participant.role).toBe(ROOM_ROLE.host);
    expect(again.participant.leftAt).toBeNull();
    expect((await loadRoom(room.id)).currentHostParticipantId).toBe(guest.participant.id);

    await expect(
      endRoom({
        roomId: room.id,
        actor: { type: "guest", guestToken: guest.guestToken! },
      }),
    ).resolves.toMatchObject({ status: "ended" });
  });

  test("PartyRoomError carries status codes", () => {
    const err = new PartyRoomError("forbidden", "nope", 403);
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
  });

  test("sweepExpiredEmptyRooms ends rooms past empty TTL", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    await leaveRoom({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });

    const emptySince = new Date(Date.now() - EMPTY_ROOM_TTL_MS - 1000);
    await prisma.room.update({
      where: { id: room.id },
      data: { emptySince },
    });

    const closed = await sweepExpiredEmptyRooms(new Date());
    expect(closed.map((r) => r.id)).toContain(room.id);

    const ended = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).not.toBeNull();
  });

  test("sweepExpiredEmptyRooms skips rooms still within TTL", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    await leaveRoom({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
    });

    await prisma.room.update({
      where: { id: room.id },
      data: { emptySince: new Date() },
    });

    const closed = await sweepExpiredEmptyRooms(new Date());
    expect(closed.map((r) => r.id)).not.toContain(room.id);

    const stillOpen = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stillOpen.status).toBe("open");
  });

  test("closing the last tab sets emptySince after speaker grace; sweeper ends it 45 minutes later", async () => {
    const host = await makeUser("Last");
    const room = await createRoom({ userId: host.id, displayName: "Last" });
    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000) },
    });

    const sweepAt = new Date();
    const closedNow = await sweepExpiredEmptyRooms(sweepAt);
    expect(closedNow.map((r) => r.id)).not.toContain(room.id);

    const emptied = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(emptied.status).toBe("open");
    expect(emptied.emptySince).not.toBeNull();

    const seat = await prisma.roomParticipant.findUniqueOrThrow({
      where: { id: room.currentHostParticipantId! },
    });
    expect(seat.leftAt).toBeNull();

    const later = new Date(sweepAt.getTime() + EMPTY_ROOM_TTL_MS + 1000);
    const closedLater = await sweepExpiredEmptyRooms(later);
    expect(closedLater.map((r) => r.id)).toContain(room.id);

    const ended = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(ended.status).toBe("ended");
  });

  test("a fresh speaker keeps emptySince null and hides Become host during the 30s silence window", async () => {
    const host = await makeUser("Speaker");
    const room = await createRoom({ userId: host.id, displayName: "Speaker" });
    const listener = await makeUser("Listener");
    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: listener.id, displayName: "Listener" },
    });

    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - NON_SPEAKER_AWAY_MS - 1000) },
    });
    const listenerSeat = await prisma.roomParticipant.findFirstOrThrow({
      where: { roomId: room.id, userId: listener.id },
    });
    await prisma.roomParticipant.update({
      where: { id: listenerSeat.id },
      data: { lastSeenAt: new Date(Date.now() - NON_SPEAKER_AWAY_MS - 1000) },
    });

    await sweepExpiredEmptyRooms(new Date());
    const still = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(still.emptySince).toBeNull();

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot?.hostTakeoverAvailable).toBe(false);
  });

  test("someone still here keeps emptySince null even when the speaker is Away", async () => {
    const host = await makeUser("Speaker");
    const room = await createRoom({ userId: host.id, displayName: "Speaker" });
    const listener = await makeUser("Listener");
    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: listener.id, displayName: "Listener" },
    });

    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000) },
    });

    await sweepExpiredEmptyRooms(new Date());
    const still = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(still.emptySince).toBeNull();

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot?.hostTakeoverAvailable).toBe(true);
  });

  test("every seated participant Away sets emptySince without setting leftAt", async () => {
    const host = await makeUser("Speaker");
    const room = await createRoom({ userId: host.id, displayName: "Speaker" });
    const listener = await makeUser("Listener");
    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: listener.id, displayName: "Listener" },
    });

    const stale = new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000);
    await prisma.roomParticipant.updateMany({
      where: { roomId: room.id, leftAt: null },
      data: { lastSeenAt: stale },
    });

    await sweepExpiredEmptyRooms(new Date());
    const emptied = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(emptied.status).toBe("open");
    expect(emptied.emptySince).not.toBeNull();

    const seats = await prisma.roomParticipant.findMany({ where: { roomId: room.id } });
    expect(seats.every((seat) => seat.leftAt === null)).toBe(true);
  });

  test("a fresh heartbeat clears emptySince and does not set leftAt", async () => {
    const host = await makeUser("Speaker");
    const room = await createRoom({ userId: host.id, displayName: "Speaker" });
    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000) },
    });

    await sweepExpiredEmptyRooms(new Date());
    const emptied = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(emptied.emptySince).not.toBeNull();

    await heartbeat({ roomId: room.id, actor: { type: "user", userId: host.id } });

    const back = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(back.emptySince).toBeNull();
    expect(back.status).toBe("open");

    const seat = await prisma.roomParticipant.findUniqueOrThrow({
      where: { id: room.currentHostParticipantId! },
    });
    expect(seat.leftAt).toBeNull();
  });

  test("sweeper clears a stale emptySince when someone is here instead of ending the room", async () => {
    const host = await makeUser("Speaker");
    const room = await createRoom({ userId: host.id, displayName: "Speaker" });
    await prisma.room.update({
      where: { id: room.id },
      data: { emptySince: new Date(Date.now() - EMPTY_ROOM_TTL_MS - 1000) },
    });

    const closed = await sweepExpiredEmptyRooms(new Date());
    expect(closed.map((r) => r.id)).not.toContain(room.id);

    const still = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(still.status).toBe("open");
    expect(still.emptySince).toBeNull();
  });

  test("Become host stays hidden for 30s after the speaker was last seen, then opens", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({ userId: hostUser.id, displayName: "Original" });
    const dj = await makeUser("StandIn");
    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: dj.id, displayName: "StandIn" },
    });

    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - NON_SPEAKER_AWAY_MS - 1000) },
    });

    expect((await getRoomSnapshot(room.id))?.hostTakeoverAvailable).toBe(false);
    await expect(
      becomeHost({ roomId: room.id, actor: { type: "user", userId: dj.id } }),
    ).rejects.toMatchObject({ code: "host_still_present" });

    await prisma.roomParticipant.update({
      where: { id: room.currentHostParticipantId! },
      data: { lastSeenAt: new Date(Date.now() - SPEAKER_SILENCE_GRACE_MS - 1000) },
    });

    expect((await getRoomSnapshot(room.id))?.hostTakeoverAvailable).toBe(true);
    const taken = await becomeHost({
      roomId: room.id,
      actor: { type: "user", userId: dj.id },
    });
    expect(taken?.currentHostParticipantId).not.toBe(room.currentHostParticipantId);
  });

  test("hostTakeoverAvailable when the host seat is empty", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Walkup" },
    });
    await leaveRoom({ roomId: room.id, actor: { type: "user", userId: host.id } });

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot?.currentHostParticipantId).toBeNull();
    expect(snapshot?.hostTakeoverAvailable).toBe(true);
    expect(snapshot?.participants).toHaveLength(1);
  });

  test("queue row keeps the adder display name after the host kicks them", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "dj",
    });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Riley" },
    });
    const track = await makeTrackWithAudio("Added Song");
    await addTrackToQueue({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
      trackId: track.id,
    });

    await kickParticipant({
      roomId: room.id,
      actor: { type: "user", userId: host.id },
      targetParticipantId: guest.participant.id,
    });

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot?.participants.map((participant) => participant.id)).not.toContain(
      guest.participant.id,
    );
    expect(snapshot?.queue).toEqual([
      expect.objectContaining({
        addedByParticipantId: guest.participant.id,
        addedByDisplayName: "Riley",
      }),
    ]);
  });

  test("queue row keeps the adder display name after they leave", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "dj",
    });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Riley" },
    });
    const track = await makeTrackWithAudio("Added Song");
    await addTrackToQueue({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
      trackId: track.id,
    });

    await leaveRoom({
      roomId: room.id,
      actor: { type: "guest", guestToken: guest.guestToken! },
    });

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot?.participants.map((participant) => participant.displayName)).not.toContain(
      "Riley",
    );
    expect(snapshot?.queue[0]?.addedByDisplayName).toBe("Riley");
  });
});
