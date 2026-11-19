import { afterEach, describe, expect, test } from "vitest";
import { fetchPlaybackTracks } from "#app/features/queue/queue-playback.server.ts";
import { fetchQueueSpine } from "#app/features/queue/queue-spine.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createTrack } from "#tests/db-utils.ts";
import { assertTrackAccessOrThrow, trackOwnershipAccessInclude } from "./track-ownership.server.ts";

type Visibility = "PRIVATE" | "PUBLIC" | "UNLISTED";

const createdUserIds: string[] = [];
const createdTrackIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
  if (createdTrackIds.length) {
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
});

async function setup(visibility: Visibility) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await prisma.user.create({
    data: {
      email: `own-${suffix}@example.com`,
      username: `own${suffix}`.slice(0, 20),
    },
  });
  const viewer = await prisma.user.create({
    data: {
      email: `view-${suffix}@example.com`,
      username: `vw${suffix}`.slice(0, 20),
    },
  });
  createdUserIds.push(owner.id, viewer.id);
  const track = await createTrack(`Shared ${suffix}`);
  createdTrackIds.push(track.id);
  await prisma.trackAudioFile.create({
    data: {
      trackId: track.id,
      serviceId: track.serviceId,
      format: "mp3",
      objectKey: `k-${suffix}`,
    },
  });
  const playlist = await prisma.userPlaylist.create({
    data: {
      title: `PL ${suffix}`,
      ownerId: owner.id,
      visibility,
      tracks: { create: { trackId: track.id, position: 0 } },
    },
  });
  return { owner, viewer, track, playlist };
}

async function loadAccess(trackId: string, userId: string) {
  return prisma.track.findUniqueOrThrow({
    where: { id: trackId },
    include: trackOwnershipAccessInclude(userId),
  });
}

describe("track access via shared playlists", () => {
  test.each(["PUBLIC", "UNLISTED"] as const)(
    "a non-owner passes the assert for a track in a %s playlist",
    async (visibility) => {
      const { viewer, track } = await setup(visibility);
      const loaded = await loadAccess(track.id, viewer.id);
      expect(() => assertTrackAccessOrThrow(loaded)).not.toThrow();
    },
  );

  test("a non-owner is denied for a track only in a PRIVATE playlist", async () => {
    const { viewer, track } = await setup("PRIVATE");
    const loaded = await loadAccess(track.id, viewer.id);
    expect(() => assertTrackAccessOrThrow(loaded)).toThrow();
  });

  test("new playlists default to PRIVATE", async () => {
    const { playlist } = await setup("PRIVATE");
    const row = await prisma.userPlaylist.create({
      data: { title: `default ${playlist.id}`, ownerId: playlist.ownerId },
    });
    expect(row.visibility).toBe("PRIVATE");
  });
});

describe("queue access for shared playlists", () => {
  test.each(["PUBLIC", "UNLISTED"] as const)(
    "a non-owner can fetch playback tracks and the spine of a %s playlist",
    async (visibility) => {
      const { viewer, track, playlist } = await setup(visibility);

      const playback = await fetchPlaybackTracks(viewer.id, [track.id]);
      expect(playback.tracks.map((t) => t.id)).toEqual([track.id]);

      const spine = await fetchQueueSpine(viewer.id, {
        context: "playlist",
        playlistId: playlist.id,
        sort: "custom",
        direction: "asc",
      });
      expect(spine.tracks.map((t) => t.id)).toEqual([track.id]);
    },
  );

  test("a non-owner gets nothing from a PRIVATE playlist", async () => {
    const { viewer, track, playlist } = await setup("PRIVATE");

    const playback = await fetchPlaybackTracks(viewer.id, [track.id]);
    expect(playback.tracks).toEqual([]);

    const spine = await fetchQueueSpine(viewer.id, {
      context: "playlist",
      playlistId: playlist.id,
      sort: "custom",
      direction: "asc",
    });
    expect(spine.tracks).toEqual([]);
  });

  test("the owner still gets their private playlist spine", async () => {
    const { owner, track, playlist } = await setup("PRIVATE");
    const spine = await fetchQueueSpine(owner.id, {
      context: "playlist",
      playlistId: playlist.id,
      sort: "custom",
      direction: "asc",
    });
    expect(spine.tracks.map((t) => t.id)).toEqual([track.id]);
  });
});
