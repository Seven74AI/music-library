import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { confirmOrphanedMatches } from "./orphaned-match-confirm.server";

/**
 * ADR-006 Edge Case 8: cross-playlist matching must be prevented. A
 * client-supplied selectedTrackId may only be confirmed if it is already a
 * member of THIS playlist (an existing ServicePlaylistTrack row), not merely
 * a track that exists in the global catalog.
 */
describe("confirmOrphanedMatches membership scoping", () => {
  beforeEach(async () => {
    await prisma.servicePlaylistTrack.deleteMany();
    await prisma.servicePlaylist.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("rejects a match to a track that is not a member of the playlist", async () => {
    consoleError.mockImplementation(() => {});
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "youtube" },
      update: {},
      create: { name: "youtube", displayName: "YouTube", baseUrl: "https://youtube.com" },
    });
    const artist = await prisma.artist.create({
      data: { name: "Test Artist", normalizedName: "test-artist" },
    });

    const memberTrack = await prisma.track.create({
      data: {
        title: "Member Track",
        artistId: artist.id,
        serviceId: service.id,
        externalId: "member-ext",
      },
    });
    const foreignTrack = await prisma.track.create({
      data: {
        title: "Foreign Track",
        artistId: artist.id,
        serviceId: service.id,
        externalId: "foreign-ext",
      },
    });

    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: service.id,
        externalId: "PL-test",
        title: "Test Playlist",
        itemCount: 1,
        ownerId: user.id,
        tracks: {
          create: {
            trackId: memberTrack.id,
            position: 1,
          },
        },
      },
    });

    const result = await confirmOrphanedMatches(
      playlist.id,
      [
        {
          deletedItemId: undefined,
          selectedTrackId: foreignTrack.id,
          position: 1,
          action: "match",
        },
      ],
      user.id,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a member of this playlist");

    // No membership row may have been created for the foreign track.
    const foreignMembership = await prisma.servicePlaylistTrack.findFirst({
      where: { playlistId: playlist.id, trackId: foreignTrack.id },
    });
    expect(foreignMembership).toBeNull();
  });

  test("confirms a match to a track that is already a member of the playlist", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "youtube" },
      update: {},
      create: { name: "youtube", displayName: "YouTube", baseUrl: "https://youtube.com" },
    });
    const artist = await prisma.artist.create({
      data: { name: "Test Artist", normalizedName: "test-artist" },
    });

    const memberTrack = await prisma.track.create({
      data: {
        title: "Member Track",
        artistId: artist.id,
        serviceId: service.id,
        externalId: "member-ext",
      },
    });

    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: service.id,
        externalId: "PL-test",
        title: "Test Playlist",
        itemCount: 1,
        ownerId: user.id,
        tracks: {
          create: {
            trackId: memberTrack.id,
            position: 1,
          },
        },
      },
    });

    const result = await confirmOrphanedMatches(
      playlist.id,
      [
        {
          deletedItemId: undefined,
          selectedTrackId: memberTrack.id,
          position: 2,
          action: "match",
        },
      ],
      user.id,
    );

    expect(result.success).toBe(true);

    const membership = await prisma.servicePlaylistTrack.findFirst({
      where: { playlistId: playlist.id, trackId: memberTrack.id },
    });
    expect(membership).not.toBeNull();
    expect(membership?.isDeleted).toBe(true);
    expect(membership?.position).toBe(2);
  });

  async function setupPlaylist() {
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "youtube" },
      update: {},
      create: { name: "youtube", displayName: "YouTube", baseUrl: "https://youtube.com" },
    });
    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: service.id,
        externalId: "PL-new",
        title: "Test Playlist",
        itemCount: 0,
        ownerId: user.id,
      },
    });
    return { user, service, playlist };
  }

  test("new match uses server-generated externalId, never the client deletedItemId", async () => {
    const { user, service, playlist } = await setupPlaylist();

    const result = await confirmOrphanedMatches(
      playlist.id,
      [
        {
          deletedItemId: "client-chosen-video-id",
          selectedTrackId: null,
          position: 3,
          action: "new",
        },
      ],
      user.id,
    );
    expect(result.success).toBe(true);

    const poisoned = await prisma.track.findFirst({
      where: { serviceId: service.id, externalId: "client-chosen-video-id" },
    });
    expect(poisoned).toBeNull();
    const track = await prisma.track.findFirst({
      where: { serviceId: service.id, externalId: { startsWith: `deleted-${playlist.id}-` } },
    });
    expect(track).not.toBeNull();
    const membership = await prisma.servicePlaylistTrack.findFirst({
      where: { playlistId: playlist.id, trackId: track!.id },
    });
    expect(membership?.playlistItemId).toBe("client-chosen-video-id");
  });

  test("double-submitting the same deletedItemId for new does not fail the batch", async () => {
    const { user, playlist } = await setupPlaylist();
    const matches = [
      { deletedItemId: "item-1", selectedTrackId: null, position: 1, action: "new" as const },
    ];

    const first = await confirmOrphanedMatches(playlist.id, matches, user.id);
    const second = await confirmOrphanedMatches(playlist.id, matches, user.id);

    expect(first.success).toBe(true);
    expect(first.processedCount).toBe(1);
    expect(second.success).toBe(true);
    expect(second.processedCount).toBe(0);
    expect(await prisma.servicePlaylistTrack.count({ where: { playlistId: playlist.id } })).toBe(1);
  });

  test("two different items confirmed new at the same position get distinct externalIds", async () => {
    const { user, service, playlist } = await setupPlaylist();
    const confirm = (id: string) =>
      confirmOrphanedMatches(
        playlist.id,
        [{ deletedItemId: id, selectedTrackId: null, position: 3, action: "new" }],
        user.id,
      );

    const first = await confirm("item-X");
    await prisma.servicePlaylistTrack.deleteMany({ where: { playlistItemId: "item-X" } });
    const second = await confirm("item-Y");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const tracks = await prisma.track.findMany({
      where: { serviceId: service.id, externalId: { startsWith: `deleted-${playlist.id}-` } },
    });
    expect(tracks).toHaveLength(2);
    expect(new Set(tracks.map((t) => t.externalId)).size).toBe(2);
  });

  test("empty-string deletedItemId on multiple new entries stores NULL, no P2002", async () => {
    const { user, playlist } = await setupPlaylist();
    const result = await confirmOrphanedMatches(
      playlist.id,
      [
        { deletedItemId: "", selectedTrackId: null, position: 1, action: "new" },
        { deletedItemId: "", selectedTrackId: null, position: 2, action: "new" },
      ],
      user.id,
    );
    expect(result.success).toBe(true);
    expect(result.processedCount).toBe(2);
    const rows = await prisma.servicePlaylistTrack.findMany({
      where: { playlistId: playlist.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.playlistItemId === null)).toBe(true);
  });

  test("match cannot select a LIVE row with a non-null playlistItemId", async () => {
    consoleError.mockImplementation(() => {});
    const { user, service, playlist } = await setupPlaylist();
    const artist = await prisma.artist.create({
      data: { name: "Live Artist", normalizedName: "live-artist" },
    });
    const track = await prisma.track.create({
      data: { title: "Live", artistId: artist.id, serviceId: service.id, externalId: "live-ext" },
    });
    await prisma.servicePlaylistTrack.create({
      data: { playlistId: playlist.id, trackId: track.id, position: 1, playlistItemId: "live-item" },
    });

    const result = await confirmOrphanedMatches(
      playlist.id,
      [{ deletedItemId: "other-item", selectedTrackId: track.id, position: 5, action: "match" }],
      user.id,
    );

    expect(result.success).toBe(false);
    const row = await prisma.servicePlaylistTrack.findFirst({
      where: { playlistId: playlist.id, trackId: track.id },
    });
    expect(row?.isDeleted).toBe(false);
    expect(row?.position).toBe(1);
    expect(row?.playlistItemId).toBe("live-item");
  });
});
