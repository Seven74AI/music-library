import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  assertPlaylistTrackCursorInScope,
  playlistTracksPagination,
} from "./playlist-tracks-pagination.server.ts";

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

describe("playlistTracksPagination", () => {
  test("does not advertise a next page when row count equals limit exactly", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const result = playlistTracksPagination(rows, 2);
    expect(result.hasNext).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.pageRows).toHaveLength(2);
  });

  test("fetches limit+1 pattern: extra row yields next cursor without empty page", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = playlistTracksPagination(rows, 2);
    expect(result.hasNext).toBe(true);
    expect(result.nextCursor).toBe("b");
    expect(result.pageRows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

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
