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
      await import("#app/utils/curator.server.ts"),
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

  test("rename updates legacy Track.genre for linked tracks", async () => {
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
        genre: oldName,
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
    const updated = await prisma.track.findUnique({
      where: { id: track.id },
      select: { genre: true },
    });
    expect(updated?.genre).toBe(newName);
  });

  test("delete clears legacy Track.genre when it matched the removed genre", async () => {
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
        genre: genreName,
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
    const updated = await prisma.track.findUnique({
      where: { id: track.id },
      select: { genre: true },
    });
    expect(updated?.genre).toBeNull();
  });
});
