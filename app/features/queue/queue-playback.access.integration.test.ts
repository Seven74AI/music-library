import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createTrack } from "#tests/db-utils.ts";
import { fetchPlaybackTracks } from "./queue-playback.server.ts";

const createdUserIds: string[] = [];
const createdTrackIds: string[] = [];
const createdPlaylistIds: string[] = [];
const createdMembershipIds: string[] = [];

afterEach(async () => {
  if (createdMembershipIds.length) {
    await prisma.servicePlaylistTrack.deleteMany({ where: { id: { in: createdMembershipIds } } });
    createdMembershipIds.length = 0;
  }
  if (createdPlaylistIds.length) {
    await prisma.servicePlaylist.deleteMany({ where: { id: { in: createdPlaylistIds } } });
    createdPlaylistIds.length = 0;
  }
  if (createdTrackIds.length) {
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("fetchPlaybackTracks service playlist access", () => {
  test("does not return tracks reachable only through a soft-deleted service-playlist row", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const owner = await prisma.user.create({
      data: {
        email: `playback-${suffix}@example.com`,
        username: `pb${suffix}`.slice(0, 20),
      },
    });
    createdUserIds.push(owner.id);

    const track = await createTrack(`Soft-deleted access ${suffix}`);
    createdTrackIds.push(track.id);

    const service = await prisma.service.findFirstOrThrow({ where: { name: "local" } });
    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: service.id,
        externalId: `pl-${suffix}`,
        title: `Playlist ${suffix}`,
        itemCount: 1,
        ownerId: owner.id,
        isActive: true,
      },
    });
    createdPlaylistIds.push(playlist.id);

    const membership = await prisma.servicePlaylistTrack.create({
      data: {
        playlistId: playlist.id,
        trackId: track.id,
        position: 0,
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
    createdMembershipIds.push(membership.id);

    const result = await fetchPlaybackTracks(owner.id, [track.id]);

    expect(result.tracks).toEqual([]);
  });
});
