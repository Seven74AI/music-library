import { describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createKaraokeTrack, createUserWithCookie } from "#tests/karaoke-fixtures.ts";
import { createRoom } from "./party-room.server.ts";
import { addPlaylistToQueue, addTrackToQueue } from "./queue.server.ts";

async function setup(kind: "party" | "karaoke") {
  const { user } = await createUserWithCookie();
  const room = await createRoom({ userId: user.id, displayName: "Host", kind });
  return { user, room, actor: { type: "user" as const, userId: user.id } };
}

async function playlistOf(ownerId: string, trackIds: string[]) {
  return prisma.userPlaylist.create({
    data: {
      ownerId,
      title: `pl-${Math.random().toString(36).slice(2)}`,
      tracks: { create: trackIds.map((trackId, position) => ({ trackId, position })) },
    },
  });
}

describe("karaoke room queue restriction", () => {
  test("karaoke room rejects add_track of a non-ready track but accepts a ready one", async () => {
    const { room, actor } = await setup("karaoke");
    const draft = await createKaraokeTrack("Q draft", { version: { status: "draft" } });
    const ready = await createKaraokeTrack("Q ready", { version: { status: "ready" } });
    await expect(
      addTrackToQueue({ roomId: room.id, actor, trackId: draft.id }),
    ).rejects.toMatchObject({ status: 400 });
    await addTrackToQueue({ roomId: room.id, actor, trackId: ready.id });
    expect(await prisma.roomQueueItem.count({ where: { roomId: room.id } })).toBe(1);
  });

  test("karaoke room rejects a whole playlist containing a non-ready track", async () => {
    const { user, room, actor } = await setup("karaoke");
    const ready = await createKaraokeTrack("P ready", { version: { status: "ready" } });
    const draft = await createKaraokeTrack("P draft", { version: { status: "draft" } });
    const bad = await playlistOf(user.id, [ready.id, draft.id]);
    await expect(
      addPlaylistToQueue({ roomId: room.id, actor, playlistId: bad.id }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await prisma.roomQueueItem.count({ where: { roomId: room.id } })).toBe(0);

    const good = await playlistOf(user.id, [ready.id]);
    const result = await addPlaylistToQueue({ roomId: room.id, actor, playlistId: good.id });
    expect(result.addedCount).toBe(1);
  });

  test("party room still accepts non-ready tracks and playlists", async () => {
    const { user, room, actor } = await setup("party");
    const draft = await createKaraokeTrack("N draft", { version: { status: "draft" } });
    const plain = await createKaraokeTrack("N none", { version: null });
    await addTrackToQueue({ roomId: room.id, actor, trackId: draft.id });
    const pl = await playlistOf(user.id, [draft.id, plain.id]);
    const result = await addPlaylistToQueue({ roomId: room.id, actor, playlistId: pl.id });
    expect(result.addedCount).toBe(2);
  });
});
