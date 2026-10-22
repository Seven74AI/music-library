import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { action, clientAction } from "./merge.tsx";

describe("POST /api/genres/merge", () => {
  const createdIds: { genres: string[]; tracks: string[]; artists: string[] } = {
    genres: [],
    tracks: [],
    artists: [],
  };
  let curatorUserId: string;

  beforeEach(async () => {
    // Create a curator user for testing
    const curatorRole = await prisma.role.findFirst({
      where: { name: "curator" },
    });

    if (!curatorRole) {
      throw new Error("Curator role not found in database");
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const curatorUser = await prisma.user.create({
      data: {
        email: `curator-${stamp}@test.com`,
        username: `curator-${stamp}`,
        roles: {
          connect: { id: curatorRole.id },
        },
      },
    });

    curatorUserId = curatorUser.id;
  });

  afterEach(async () => {
    // Clean up tracks first (they reference genres)
    if (createdIds.tracks.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: createdIds.tracks } } });
      createdIds.tracks.length = 0;
    }

    // Clean up artists
    if (createdIds.artists.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdIds.artists } } });
      createdIds.artists.length = 0;
    }

    // Then clean up genres
    if (createdIds.genres.length > 0) {
      await prisma.genre.deleteMany({ where: { id: { in: createdIds.genres } } });
      createdIds.genres.length = 0;
    }

    if (curatorUserId) {
      await prisma.user.delete({ where: { id: curatorUserId } }).catch(() => {});
    }
  });

  test("merges multiple genres into target", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create test genres
    const targetGenre = await prisma.genre.create({
      data: {
        name: `Rock ${stamp}`,
        normalizedName: `rock ${stamp}`,
      },
    });
    const sourceGenre1 = await prisma.genre.create({
      data: {
        name: `Classic Rock ${stamp}`,
        normalizedName: `classic rock ${stamp}`,
      },
    });
    const sourceGenre2 = await prisma.genre.create({
      data: {
        name: `Hard Rock ${stamp}`,
        normalizedName: `hard rock ${stamp}`,
      },
    });

    createdIds.genres.push(targetGenre.id, sourceGenre1.id, sourceGenre2.id);

    // Create test artist and tracks
    const youtubeService = await prisma.service.findFirst({
      where: { name: "youtube" },
    });

    if (!youtubeService) {
      throw new Error("YouTube service not found");
    }

    const artist = await prisma.artist.create({
      data: {
        name: `Test Artist ${stamp}`,
        normalizedName: `test artist ${stamp}`,
      },
    });
    createdIds.artists.push(artist.id);

    const track1 = await prisma.track.create({
      data: {
        title: `Track 1 ${stamp}`,
        artistId: artist.id,
        serviceId: youtubeService.id,
        externalId: `ext-1-${stamp}`,
      },
    });
    const track2 = await prisma.track.create({
      data: {
        title: `Track 2 ${stamp}`,
        artistId: artist.id,
        serviceId: youtubeService.id,
        externalId: `ext-2-${stamp}`,
      },
    });

    createdIds.tracks.push(track1.id, track2.id);

    // Link tracks to source genres
    await prisma.$executeRaw`INSERT INTO _TrackGenres (A, B) VALUES (${sourceGenre1.id}, ${track1.id})`;
    await prisma.$executeRaw`INSERT INTO _TrackGenres (A, B) VALUES (${sourceGenre2.id}, ${track2.id})`;

    // Mock request
    const request = new Request("http://localhost/api/genres/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceIds: [sourceGenre1.id, sourceGenre2.id],
        targetId: targetGenre.id,
      }),
    });

    vi.spyOn(
      await import("#app/utils/curator.server.ts"),
      "requireCuratorOrAdmin",
    ).mockResolvedValue(curatorUserId);

    const response = await action({
      request,
      params: {},
      context: {},
    } as never);

    const body = (await response.json()) as {
      success: boolean;
      tracksRelinked: number;
      sourceGenresDeleted: number;
      targetGenre: { id: string; name: string; trackCount: number };
    };

    expect(body.success).toBe(true);
    expect(body.sourceGenresDeleted).toBe(2);
    expect(body.tracksRelinked).toBe(2);
    expect(body.targetGenre?.trackCount).toBe(2);

    // Verify source genres were deleted
    const remainingGenres = await prisma.genre.findMany({
      where: { id: { in: [sourceGenre1.id, sourceGenre2.id] } },
    });
    expect(remainingGenres).toHaveLength(0);

    // Verify tracks are now linked to target
    const targetLinks = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM _TrackGenres WHERE A = ${targetGenre.id}
    `;
    expect(Number(targetLinks[0]?.count)).toBe(2);

    vi.mocked((await import("#app/utils/curator.server.ts")).requireCuratorOrAdmin).mockRestore();
  });

  test("returns 400 if target is in sources", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const genre = await prisma.genre.create({
      data: {
        name: `Test ${stamp}`,
        normalizedName: `test ${stamp}`,
      },
    });
    createdIds.genres.push(genre.id);

    const request = new Request("http://localhost/api/genres/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceIds: [genre.id],
        targetId: genre.id, // Same as source
      }),
    });

    vi.spyOn(
      await import("#app/utils/curator.server.ts"),
      "requireCuratorOrAdmin",
    ).mockResolvedValue(curatorUserId);

    await expect(async () => {
      await action({
        request,
        params: {},
        context: {},
      } as never);
    }).rejects.toThrow();

    vi.mocked((await import("#app/utils/curator.server.ts")).requireCuratorOrAdmin).mockRestore();
  });

  test("returns 404 if genres not found", async () => {
    const request = new Request("http://localhost/api/genres/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceIds: ["nonexistent-1"],
        targetId: "nonexistent-2",
      }),
    });

    vi.spyOn(
      await import("#app/utils/curator.server.ts"),
      "requireCuratorOrAdmin",
    ).mockResolvedValue(curatorUserId);

    await expect(async () => {
      await action({
        request,
        params: {},
        context: {},
      } as never);
    }).rejects.toThrow();

    vi.mocked((await import("#app/utils/curator.server.ts")).requireCuratorOrAdmin).mockRestore();
  });

  test("handles tracks already linked to target", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create genres
    const targetGenre = await prisma.genre.create({
      data: {
        name: `Rock ${stamp}`,
        normalizedName: `rock ${stamp}`,
      },
    });
    const sourceGenre = await prisma.genre.create({
      data: {
        name: `Classic Rock ${stamp}`,
        normalizedName: `classic rock ${stamp}`,
      },
    });

    createdIds.genres.push(targetGenre.id, sourceGenre.id);

    // Create artist and track
    const youtubeService = await prisma.service.findFirst({
      where: { name: "youtube" },
    });

    if (!youtubeService) {
      throw new Error("YouTube service not found");
    }

    const artist = await prisma.artist.create({
      data: {
        name: `Test Artist ${stamp}`,
        normalizedName: `test artist ${stamp}`,
      },
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

    // Link track to BOTH target and source
    await prisma.$executeRaw`INSERT INTO _TrackGenres (A, B) VALUES (${targetGenre.id}, ${track.id})`;
    await prisma.$executeRaw`INSERT INTO _TrackGenres (A, B) VALUES (${sourceGenre.id}, ${track.id})`;

    // Mock request
    const request = new Request("http://localhost/api/genres/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceIds: [sourceGenre.id],
        targetId: targetGenre.id,
      }),
    });

    vi.spyOn(
      await import("#app/utils/curator.server.ts"),
      "requireCuratorOrAdmin",
    ).mockResolvedValue(curatorUserId);

    const response = await action({
      request,
      params: {},
      context: {},
    } as never);

    const body = (await response.json()) as {
      success: boolean;
      tracksRelinked: number;
      targetGenre: { trackCount: number };
    };

    // Should not create duplicate link
    expect(body.tracksRelinked).toBe(0);
    expect(body.targetGenre?.trackCount).toBe(1);

    // Verify only one link exists
    const targetLinks = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM _TrackGenres WHERE A = ${targetGenre.id}
    `;
    expect(Number(targetLinks[0]?.count)).toBe(1);

    vi.mocked((await import("#app/utils/curator.server.ts")).requireCuratorOrAdmin).mockRestore();
  });
});

describe("clientAction for POST /api/genres/merge", () => {
  test("proxies to the server action instead of throwing", async () => {
    const serverAction = vi.fn().mockResolvedValue({
      success: true,
      tracksRelinked: 1,
      sourceGenresDeleted: 1,
    });

    const result = await clientAction({
      request: new Request("http://localhost/api/genres/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: ["source-genre"],
          targetId: "target-genre",
        }),
      }),
      serverAction,
      params: {},
    } as never);

    expect(serverAction).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: true,
      tracksRelinked: 1,
      sourceGenresDeleted: 1,
    });
  });
});
