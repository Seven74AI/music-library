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
  claimOpenGuestSeatForUser,
  createRoom,
  endRoom,
  findOpenRoomByCode,
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

    const oldRoom = await prisma.room.findUniqueOrThrow({ where: { id: first.id } });
    expect(oldRoom.status).toBe("open");
  });

  test("creator still seated in their open room cannot open another", async () => {
    const user = await makeUser();
    await createRoom({ userId: user.id, displayName: "Host" });
    await expect(createRoom({ userId: user.id, displayName: "Host" })).rejects.toMatchObject({
      code: "already_in_room",
    });
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

  test("concurrent joins seat a user in only one room", async () => {
    const host1 = await makeUser("Host1");
    const host2 = await makeUser("Host2");
    const room1 = await createRoom({ userId: host1.id, displayName: "Room1" });
    const room2 = await createRoom({ userId: host2.id, displayName: "Room2" });
    const member = await makeUser("Member");

    const outcomes = await Promise.allSettled([
      joinRoom({
        code: room1.code,
        actor: { type: "user", userId: member.id, displayName: "Member" },
      }),
      joinRoom({
        code: room2.code,
        actor: { type: "user", userId: member.id, displayName: "Member" },
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ code: "already_in_room" });
    }

    const activeSeats = await prisma.roomParticipant.count({
      where: { userId: member.id, leftAt: null },
    });
    expect(activeSeats).toBe(1);
  });

  test("returning guest cannot hold open seats in two rooms concurrently", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });
    const guestToken = "returning-guest-token";

    await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Traveler", guestToken },
    });
    await leaveRoom({
      roomId: roomA.id,
      actor: { type: "guest", guestToken },
    });
    await joinRoom({
      code: roomB.code,
      actor: { type: "guest", displayName: "Traveler", guestToken },
    });
    await leaveRoom({
      roomId: roomB.id,
      actor: { type: "guest", guestToken },
    });

    const outcomes = await Promise.allSettled([
      joinRoom({
        code: roomA.code,
        actor: { type: "guest", displayName: "Traveler", guestToken },
      }),
      joinRoom({
        code: roomB.code,
        actor: { type: "guest", displayName: "Traveler", guestToken },
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ code: "already_in_room" });
    }

    expect(
      await prisma.roomParticipant.count({
        where: { guestTokenHash: hashGuestToken(guestToken), leftAt: null },
      }),
    ).toBe(1);
  });

  test("signed-in user rejoin after leave does not keep a concurrent seat elsewhere", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });
    const member = await makeUser("Member");

    await joinRoom({
      code: roomA.code,
      actor: { type: "user", userId: member.id, displayName: "Member" },
    });
    await leaveRoom({
      roomId: roomA.id,
      actor: { type: "user", userId: member.id },
    });
    await joinRoom({
      code: roomB.code,
      actor: { type: "user", userId: member.id, displayName: "Member" },
    });

    await expect(
      joinRoom({
        code: roomA.code,
        actor: { type: "user", userId: member.id, displayName: "Member" },
      }),
    ).rejects.toMatchObject({ code: "already_in_room" });

    expect(
      await prisma.roomParticipant.count({
        where: { userId: member.id, leftAt: null },
      }),
    ).toBe(1);
    const inB = await prisma.roomParticipant.findFirst({
      where: { userId: member.id, leftAt: null, roomId: roomB.id },
    });
    expect(inB).not.toBeNull();
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

  test("claiming a guest seat while already seated in the same room vacates the guest seat", async () => {
    const host = await makeUser("Host");
    const member = await makeUser("Member");
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const guest = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Walkup" },
    });

    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Member" },
    });

    await claimOpenGuestSeatForUser({
      userId: member.id,
      guestToken: guest.guestToken!,
      roomId: room.id,
    });

    const openForMember = await prisma.roomParticipant.findMany({
      where: { roomId: room.id, leftAt: null, userId: member.id },
      select: { id: true },
    });
    expect(openForMember).toHaveLength(1);

    const guestSeat = await prisma.roomParticipant.findUnique({
      where: { id: guest.participant.id },
      select: { leftAt: true, guestTokenHash: true },
    });
    expect(guestSeat?.leftAt).not.toBeNull();
    expect(guestSeat?.guestTokenHash).not.toBeNull();
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
  test("still-seated user can rejoin a full room from another device", async () => {
    const host = await makeUser();
    const member = await makeUser("Member");
    const room = await createRoom({ userId: host.id, displayName: "Host" });

    const first = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Member" },
    });

    for (let i = 0; i < MAX_PARTICIPANTS - 2; i++) {
      await joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: `G${String(i).padStart(2, "0")}` },
      });
    }

    const second = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: member.id, displayName: "Member Again" },
    });

    expect(second.participant.id).toBe(first.participant.id);
    expect(second.participant.displayName).toBe("Member Again");
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id, leftAt: null } })).toBe(
      MAX_PARTICIPANTS,
    );
  }, 30_000);

  test("still-seated guest can rejoin a full room with the same token", async () => {
    const host = await makeUser();
    const room = await createRoom({ userId: host.id, displayName: "Host" });
    const cookieToken = "still-seated-guest-token";

    const first = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Guest", guestToken: cookieToken },
    });

    for (let i = 0; i < MAX_PARTICIPANTS - 2; i++) {
      await joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: `G${String(i).padStart(2, "0")}` },
      });
    }

    const second = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Guest", guestToken: cookieToken },
    });

    expect(second.participant.id).toBe(first.participant.id);
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id, leftAt: null } })).toBe(
      MAX_PARTICIPANTS,
    );
  }, 30_000);

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

  test("seat return reactivation respects capacity under concurrent new joins", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({ userId: host.id, displayName: "Host" });

    const returner = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Returner", guestToken: "returner-guest-token" },
    });

    for (let i = 0; i < MAX_PARTICIPANTS - 2; i++) {
      await joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: `Fill${String(i).padStart(2, "0")}` },
      });
    }

    await leaveRoom({
      roomId: room.id,
      actor: { type: "guest", guestToken: returner.guestToken! },
    });
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id, leftAt: null } })).toBe(
      MAX_PARTICIPANTS - 1,
    );

    const outcomes = await Promise.allSettled([
      joinRoom({
        code: room.code,
        actor: {
          type: "guest",
          displayName: "Returner",
          guestToken: returner.guestToken!,
        },
      }),
      joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: "Concurrent Newcomer" },
      }),
    ]);

    const rejected = outcomes.filter(
      (outcome) => outcome.status === "rejected" && outcome.reason instanceof PartyRoomError,
    );
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "room_full" });
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id, leftAt: null } })).toBe(
      MAX_PARTICIPANTS,
    );
  }, 30_000);

  test("reuses the caller guest cookie instead of minting a new token for a first seat", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "listener",
    });
    const cookieToken = "guest-cookie-token-from-browser";

    const joined = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Cookie Guest", guestToken: cookieToken },
    });

    expect(joined.guestToken).toBe(cookieToken);
    expect(joined.participant.guestTokenHash).toBe(hashGuestToken(cookieToken));

    const seated = await prisma.roomParticipant.count({
      where: { roomId: room.id, leftAt: null },
    });
    expect(seated).toBe(2);
  });

  test("a second join with the same guest token does not create a duplicate seat", async () => {
    const host = await makeUser("Host");
    const room = await createRoom({
      userId: host.id,
      displayName: "Host",
      defaultJoinRole: "listener",
    });
    const cookieToken = "shared-guest-cookie-token";

    const first = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Guest", guestToken: cookieToken },
    });
    const second = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "Guest", guestToken: cookieToken },
    });

    expect(second.participant.id).toBe(first.participant.id);
    expect(
      await prisma.roomParticipant.count({
        where: { roomId: room.id, guestTokenHash: hashGuestToken(cookieToken), leftAt: null },
      }),
    ).toBe(1);
  });

  test("a logged-in user with a guest seat who fails to join a full room keeps that guest seat", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const member = await makeUser("Member");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });

    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Walkup" },
    });

    for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) {
      await joinRoom({
        code: roomB.code,
        actor: { type: "guest", displayName: `B${String(i).padStart(2, "0")}` },
      });
    }

    await expect(
      joinRoom({
        code: roomB.code,
        actor: {
          type: "user",
          userId: member.id,
          guestToken: guest.guestToken,
        },
      }),
    ).rejects.toMatchObject({ code: "room_full" });

    const stillSeated = await prisma.roomParticipant.findFirst({
      where: { id: guest.participant.id, leftAt: null },
    });
    expect(stillSeated).not.toBeNull();
    expect(stillSeated?.roomId).toBe(roomA.id);
  }, 30_000);

  test("a guest who fails to join a full room keeps their previous seat", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });

    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Walkup" },
    });

    for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) {
      await joinRoom({
        code: roomB.code,
        actor: { type: "guest", displayName: `B${String(i).padStart(2, "0")}` },
      });
    }

    await expect(
      joinRoom({
        code: roomB.code,
        actor: {
          type: "guest",
          displayName: "Walkup",
          guestToken: guest.guestToken,
        },
      }),
    ).rejects.toMatchObject({ code: "room_full" });

    const stillSeated = await prisma.roomParticipant.findFirst({
      where: { id: guest.participant.id, leftAt: null },
    });
    expect(stillSeated).not.toBeNull();
    expect(stillSeated?.roomId).toBe(roomA.id);
  }, 30_000);

  test("concurrent guest claim and user join cannot seat the same user twice", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const member = await makeUser("Member");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });
    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Walkup" },
    });

    await Promise.allSettled([
      claimOpenGuestSeatForUser({
        userId: member.id,
        guestToken: guest.guestToken!,
        roomId: roomA.id,
      }),
      joinRoom({
        code: roomB.code,
        actor: { type: "user", userId: member.id, displayName: "Member" },
      }),
    ]);

    const openSeats = await prisma.roomParticipant.count({
      where: { userId: member.id, leftAt: null },
    });
    expect(openSeats).toBeLessThanOrEqual(1);
  });

  test("concurrent room switch and stale refresh leave the old guest seat vacated", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });
    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Walkup" },
    });
    const token = guest.guestToken!;

    await Promise.allSettled([
      joinRoom({
        code: roomB.code,
        actor: { type: "guest", displayName: "Walkup", guestToken: token },
      }),
      joinRoom({
        code: roomA.code,
        actor: { type: "guest", displayName: "Walkup", guestToken: token },
      }),
    ]);

    const seatA = await prisma.roomParticipant.findUnique({
      where: { id: guest.participant.id },
      select: { leftAt: true },
    });
    expect(seatA?.leftAt).not.toBeNull();

    const openWithToken = await prisma.roomParticipant.count({
      where: { guestTokenHash: hashGuestToken(token), leftAt: null },
    });
    expect(openWithToken).toBe(1);
  });

  test("guest refresh does not heal a duplicate open seat in another room", async () => {
    const hostA = await makeUser("Host A");
    const hostB = await makeUser("Host B");
    const roomA = await createRoom({ userId: hostA.id, displayName: "Host A" });
    const roomB = await createRoom({ userId: hostB.id, displayName: "Host B" });
    const guest = await joinRoom({
      code: roomA.code,
      actor: { type: "guest", displayName: "Walkup" },
    });
    const tokenHash = hashGuestToken(guest.guestToken!);
    await prisma.roomParticipant.create({
      data: {
        roomId: roomB.id,
        guestTokenHash: tokenHash,
        displayName: "Phantom",
        role: ROOM_ROLE.listener,
        lastSeenAt: new Date(),
      },
    });

    await expect(
      joinRoom({
        code: roomA.code,
        actor: { type: "guest", displayName: "Walkup", guestToken: guest.guestToken },
      }),
    ).rejects.toMatchObject({ code: "already_in_room" });
  });

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
    ).rejects.toMatchObject({ code: "room_ended", status: 410 });
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

  test("findOpenRoomByCode distinguishes ended rooms from missing codes", async () => {
    const host = await makeUser();
    const open = await createRoom({ userId: host.id, displayName: "Host" });
    await expect(findOpenRoomByCode(open.code)).resolves.toMatchObject({ code: open.code });

    await endRoom({ roomId: open.id, actor: { type: "user", userId: host.id } });
    await expect(findOpenRoomByCode(open.code)).rejects.toMatchObject({
      code: "room_ended",
      status: 410,
    });

    await expect(findOpenRoomByCode("ABCDEF")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
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

  test("becomeHost prefers DJ over Listener when both are eligible", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({
      userId: hostUser.id,
      displayName: "Original",
      defaultJoinRole: "listener",
    });
    const djUser = await makeUser("DJ");
    const listenerUser = await makeUser("Listener");
    const djJoin = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: djUser.id, displayName: "DJ" },
    });
    await prisma.roomParticipant.update({
      where: { id: djJoin.participant.id },
      data: { role: ROOM_ROLE.dj },
    });
    await joinRoom({
      code: room.code,
      actor: { type: "user", userId: listenerUser.id, displayName: "Listener" },
    });

    await agePastGrace(room.currentHostParticipantId!);

    await expect(
      becomeHost({
        roomId: room.id,
        actor: { type: "user", userId: listenerUser.id },
      }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });

    const taken = await becomeHost({
      roomId: room.id,
      actor: { type: "user", userId: djUser.id },
    });
    expect(taken?.currentHostParticipantId).not.toBe(room.currentHostParticipantId);
    expect(taken?.participants.find((p) => p.userId === djUser.id)?.role).toBe(ROOM_ROLE.host);
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

  test("kicked reclaim holder cannot reclaim host after rejoining", async () => {
    const hostUser = await makeUser("Original");
    const room = await createRoom({ userId: hostUser.id, displayName: "Original" });
    const creatorSeatId = room.participants[0]!.id;

    const standIn = await joinRoom({
      code: room.code,
      actor: { type: "guest", displayName: "StandIn" },
    });

    await agePastGrace(creatorSeatId);
    await becomeHost({
      roomId: room.id,
      actor: { type: "guest", guestToken: standIn.guestToken! },
    });
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(creatorSeatId);

    await kickParticipant({
      roomId: room.id,
      actor: { type: "guest", guestToken: standIn.guestToken! },
      targetParticipantId: creatorSeatId,
    });
    expect(reclaimSeatId(await loadRoom(room.id))).toBe(standIn.participant.id);

    const rejoined = await joinRoom({
      code: room.code,
      actor: { type: "user", userId: hostUser.id, displayName: "Original" },
    });
    expect(rejoined.participant.id).toBe(creatorSeatId);

    await expect(
      reclaimHost({ roomId: room.id, actor: { type: "user", userId: hostUser.id } }),
    ).rejects.toMatchObject({ code: "not_original_host" });
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

  describe("round 18 — host/presence transaction atomicity", () => {
    test("reclaimHost demotes the live speaker pointer inside one transaction", async () => {
      const hostUser = await makeUser("Original");
      const room = await createRoom({ userId: hostUser.id, displayName: "Original" });
      const creatorSeatId = room.participants[0]!.id;
      const standIn = await joinRoom({
        code: room.code,
        actor: { type: "guest", displayName: "StandIn" },
      });

      await agePastGrace(creatorSeatId);
      await becomeHost({
        roomId: room.id,
        actor: { type: "guest", guestToken: standIn.guestToken! },
      });

      await prisma.roomParticipant.update({
        where: { id: creatorSeatId },
        data: { role: ROOM_ROLE.host },
      });

      await reclaimHost({
        roomId: room.id,
        actor: { type: "user", userId: hostUser.id },
      });

      const seats = await prisma.roomParticipant.findMany({
        where: { roomId: room.id, leftAt: null, role: ROOM_ROLE.host },
      });
      expect(seats).toHaveLength(1);
      expect(seats[0]?.id).toBe(creatorSeatId);
      expect((await loadRoom(room.id)).currentHostParticipantId).toBe(creatorSeatId);

      const standInSeat = await prisma.roomParticipant.findUniqueOrThrow({
        where: { id: standIn.participant.id },
      });
      expect(standInSeat.role).toBe(ROOM_ROLE.dj);
    });

    test("leaveRoom clears the speaker pointer only when the leaver still holds it", async () => {
      const hostUser = await makeUser("Original");
      const room = await createRoom({ userId: hostUser.id, displayName: "Original" });
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

      await leaveRoom({
        roomId: room.id,
        actor: { type: "user", userId: hostUser.id },
      });

      const after = await loadRoom(room.id);
      expect(after.currentHostParticipantId).toBe(alice.participant.id);

      const hosts = await prisma.roomParticipant.findMany({
        where: { roomId: room.id, leftAt: null, role: ROOM_ROLE.host },
      });
      expect(hosts).toHaveLength(1);
      expect(hosts[0]?.id).toBe(alice.participant.id);
    });

    test("system endRoom aborts when someone is present despite stale emptySince", async () => {
      const host = await makeUser("Speaker");
      const room = await createRoom({ userId: host.id, displayName: "Speaker" });
      const cutoff = new Date(Date.now() - EMPTY_ROOM_TTL_MS);

      await prisma.room.update({
        where: { id: room.id },
        data: { emptySince: new Date(cutoff.getTime() - 60_000) },
      });

      const stillOpen = await endRoom({
        roomId: room.id,
        actor: { type: "system" },
        emptyExpiryCutoff: cutoff,
      });
      expect(stillOpen.status).toBe("open");
      expect(stillOpen.endedAt).toBeNull();

      const seat = await prisma.roomParticipant.findFirstOrThrow({
        where: { roomId: room.id, leftAt: null },
      });
      expect(seat.leftAt).toBeNull();
    });
  });
});
