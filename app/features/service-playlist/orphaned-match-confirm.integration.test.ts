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
    const foreignMembership = await prisma.servicePlaylistTrack.findUnique({
      where: {
        playlistId_trackId: {
          playlistId: playlist.id,
          trackId: foreignTrack.id,
        },
      },
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

    const membership = await prisma.servicePlaylistTrack.findUnique({
      where: {
        playlistId_trackId: {
          playlistId: playlist.id,
          trackId: memberTrack.id,
        },
      },
    });
    expect(membership).not.toBeNull();
    expect(membership?.isDeleted).toBe(true);
    expect(membership?.position).toBe(2);
  });
});
