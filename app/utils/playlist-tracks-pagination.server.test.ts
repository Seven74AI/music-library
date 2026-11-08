import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { assertPlaylistTrackCursorInScope } from "./playlist-tracks-pagination.server.ts";

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

describe("assertPlaylistTrackCursorInScope", () => {
  beforeEach(async () => {
    await prisma.userPlaylistTrack.deleteMany();
    await prisma.userPlaylist.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("rejects a cursor row from another playlist", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const service = await ensureLocalService();
    const artist = await prisma.artist.create({
      data: { name: "A", normalizedName: "a" },
    });
    const track = await prisma.track.create({
      data: { title: "T", externalId: "ext", serviceId: service.id, artistId: artist.id },
    });
    const playlistA = await prisma.userPlaylist.create({
      data: { title: "A", ownerId: user.id },
    });
    const playlistB = await prisma.userPlaylist.create({
      data: { title: "B", ownerId: user.id },
    });
    const cursorRow = await prisma.userPlaylistTrack.create({
      data: { playlistId: playlistA.id, trackId: track.id, position: 1 },
    });

    await expect(
      assertPlaylistTrackCursorInScope({
        userId: user.id,
        playlistId: playlistB.id,
        cursor: cursorRow.id,
        kind: "user",
      }),
    ).rejects.toThrow(/Invalid cursor format/);
  });
});
