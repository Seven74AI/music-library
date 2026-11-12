import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { action } from "./$id.tsx";

describe("PUT/DELETE /api/genres/:id (server action)", () => {
  const createdIds: { genres: string[]; tracks: string[]; artists: string[] } = {
    genres: [],
    tracks: [],
    artists: [],
  };
  let curatorUserId: string;
  let requireCuratorSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(async () => {
    const curatorRole = await prisma.role.findFirst({ where: { name: "curator" } });
    if (!curatorRole) throw new Error("Curator role not found");

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const curatorUser = await prisma.user.create({
      data: {
        email: `curator-id-${stamp}@test.com`,
        username: `curator-id-${stamp}`,
        roles: { connect: { id: curatorRole.id } },
      },
    });
    curatorUserId = curatorUser.id;

    requireCuratorSpy = vi.spyOn(
      await import("#app/utils/permissions.server.ts"),
      "requireCuratorOrAdmin",
    );
    requireCuratorSpy.mockResolvedValue(curatorUserId);
  });

  afterEach(async () => {
    requireCuratorSpy?.mockRestore();
    if (createdIds.tracks.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: createdIds.tracks } } });
      createdIds.tracks.length = 0;
    }
    if (createdIds.artists.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdIds.artists } } });
      createdIds.artists.length = 0;
    }
    if (createdIds.genres.length > 0) {
      await prisma.genre.deleteMany({ where: { id: { in: createdIds.genres } } });
      createdIds.genres.length = 0;
    }
    if (curatorUserId) {
      await prisma.user.delete({ where: { id: curatorUserId } }).catch(() => {});
    }
  });

  test("rename keeps M2M links for linked tracks", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const oldName = `Indie ${stamp}`;
    const newName = `Independent ${stamp}`;

    const genre = await prisma.genre.create({
      data: { name: oldName, normalizedName: oldName.toLowerCase() },
    });
    createdIds.genres.push(genre.id);

    const youtubeService = await prisma.service.findFirst({ where: { name: "youtube" } });
    if (!youtubeService) throw new Error("YouTube service not found");

    const artist = await prisma.artist.create({
      data: { name: `Artist ${stamp}`, normalizedName: `artist ${stamp}` },
    });
    createdIds.artists.push(artist.id);

    const track = await prisma.track.create({
      data: {
        title: `Track ${stamp}`,
        artistId: artist.id,
        serviceId: youtubeService.id,
        externalId: `ext-${stamp}`,
      },
    });
    createdIds.tracks.push(track.id);

    await prisma.$executeRaw`INSERT INTO _TrackGenres (A, B) VALUES (${genre.id}, ${track.id})`;

    const response = await action({
      request: new Request(`http://localhost/api/genres/${genre.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      }),
      params: { id: genre.id },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    const links = await prisma.$queryRaw<Array<{ a: string }>>`
      SELECT A as a FROM _TrackGenres WHERE B = ${track.id}
    `;
    expect(links).toHaveLength(1);
    expect(links[0]?.a).toBe(genre.id);
  });

  test("delete removes genre links without deleting tracks", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const genreName = `Doom ${stamp}`;

    const genre = await prisma.genre.create({
      data: { name: genreName, normalizedName: genreName.toLowerCase() },
    });
    createdIds.genres.push(genre.id);

    const youtubeService = await prisma.service.findFirst({ where: { name: "youtube" } });
    if (!youtubeService) throw new Error("YouTube service not found");

    const artist = await prisma.artist.create({
      data: { name: `Artist ${stamp}`, normalizedName: `artist ${stamp}` },
    });
    createdIds.artists.push(artist.id);

    const track = await prisma.track.create({
      data: {
        title: `Track ${stamp}`,
        artistId: artist.id,
        serviceId: youtubeService.id,
        externalId: `ext-del-${stamp}`,
      },
    });
    createdIds.tracks.push(track.id);

    await prisma.$executeRaw`INSERT INTO _TrackGenres (A, B) VALUES (${genre.id}, ${track.id})`;

    const response = await action({
      request: new Request(`http://localhost/api/genres/${genre.id}`, { method: "DELETE" }),
      params: { id: genre.id },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    const links = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM _TrackGenres WHERE B = ${track.id}
    `;
    expect(Number(links[0]?.count)).toBe(0);
    const stillThere = await prisma.track.findUnique({
      where: { id: track.id },
      select: { id: true },
    });
    expect(stillThere?.id).toBe(track.id);
  });
});
