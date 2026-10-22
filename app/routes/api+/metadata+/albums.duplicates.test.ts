import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { loader } from "./albums.duplicates.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("GET /api/metadata/albums/duplicates", () => {
  let mockUserId: string;

  beforeEach(async () => {
    mockUserId = "test-user-id";
    vi.mocked(requireUserId).mockResolvedValue(mockUserId);
    await prisma.track.deleteMany();
    await prisma.album.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("curator can find duplicate albums", async () => {
    await prisma.role.upsert({
      where: { name: "curator" },
      update: {},
      create: { name: "curator", description: "Curator" },
    });

    await prisma.user.create({
      data: {
        id: mockUserId,
        email: "curator@test.com",
        username: "curator",
        roles: { connect: { name: "curator" } },
      },
    });

    // Create service (use upsert)
    const service = await prisma.service.upsert({
      where: { name: "test" },
      update: {},
      create: {
        name: "test",
        displayName: "Test",
        baseUrl: "http://test.com",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    // Create albums with same artist and name
    const album1 = await prisma.album.create({
      data: {
        name: "Abbey Road",
        artistId: artist.id,
      },
    });

    const album2 = await prisma.album.create({
      data: {
        name: "Abbey Road",
        artistId: artist.id,
      },
    });

    // Create tracks for each album
    await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: artist.id,
        albumId: album1.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    await prisma.track.create({
      data: {
        title: "Track 2",
        artistId: artist.id,
        albumId: album1.id,
        serviceId: service.id,
        externalId: "track2",
      },
    });

    await prisma.track.create({
      data: {
        title: "Track 3",
        artistId: artist.id,
        albumId: album2.id,
        serviceId: service.id,
        externalId: "track3",
      },
    });

    // Add another track to album2 so both have >= 2 tracks (default minTracks)
    await prisma.track.create({
      data: {
        title: "Track 4",
        artistId: artist.id,
        albumId: album2.id,
        serviceId: service.id,
        externalId: "track4",
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]?.artistId).toBe(artist.id);
    expect(data.groups[0]?.artistName).toBe("Artist");
    expect(data.groups[0]?.name).toBe("Abbey Road");
    expect(data.groups[0]?.albums).toHaveLength(2);

    const albums = data.groups[0]?.albums;
    expect(albums?.some((a: any) => a.id === album1.id && a.trackCount === 2)).toBe(true);
    expect(albums?.some((a: any) => a.id === album2.id && a.trackCount === 2)).toBe(true);
  });

  test("filters by minimum track count", async () => {
    await prisma.role.upsert({
      where: { name: "curator" },
      update: {},
      create: { name: "curator", description: "Curator" },
    });

    await prisma.user.create({
      data: {
        id: mockUserId,
        email: "curator@test.com",
        username: "curator",
        roles: { connect: { name: "curator" } },
      },
    });

    // Create service (use upsert)
    const service = await prisma.service.upsert({
      where: { name: "test" },
      update: {},
      create: {
        name: "test",
        displayName: "Test",
        baseUrl: "http://test.com",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    // Create albums with same name
    const album1 = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist.id,
      },
    });

    const album2 = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist.id,
      },
    });

    // Create 2 tracks for album1 (meets threshold)
    for (let i = 1; i <= 2; i++) {
      await prisma.track.create({
        data: {
          title: `Track ${i}`,
          artistId: artist.id,
          albumId: album1.id,
          serviceId: service.id,
          externalId: `track${i}`,
        },
      });
    }

    // Create 3 tracks for album2 (meets threshold)
    for (let i = 3; i <= 5; i++) {
      await prisma.track.create({
        data: {
          title: `Track ${i}`,
          artistId: artist.id,
          albumId: album2.id,
          serviceId: service.id,
          externalId: `track${i}`,
        },
      });
    }

    const request = new Request("http://localhost/api/metadata/albums/duplicates?minTracks=2", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    expect(data.groups).toHaveLength(1);

    const albums = data.groups[0]?.albums;
    // Both albums should be included (both have >= 2 tracks)
    expect(albums?.length).toBe(2);
    expect(albums?.some((a: any) => a.id === album1.id && a.trackCount === 2)).toBe(true);
    expect(albums?.some((a: any) => a.id === album2.id && a.trackCount === 3)).toBe(true);
  });

  test("excludes merged albums", async () => {
    await prisma.role.upsert({
      where: { name: "curator" },
      update: {},
      create: { name: "curator", description: "Curator" },
    });

    const curator = await prisma.user.create({
      data: {
        id: mockUserId,
        email: "curator@test.com",
        username: "curator",
        roles: { connect: { name: "curator" } },
      },
    });

    // Create service (use upsert)
    const service = await prisma.service.upsert({
      where: { name: "test" },
      update: {},
      create: {
        name: "test",
        displayName: "Test",
        baseUrl: "http://test.com",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    const album1 = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist.id,
      },
    });

    await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist.id,
        mergedIntoId: album1.id,
        mergedAt: new Date(),
        mergedBy: curator.id,
      },
    });

    // Create tracks
    await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: artist.id,
        albumId: album1.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    // No duplicates since merged album is excluded
    expect(data.groups).toHaveLength(0);
  });

  test("groups albums by artist and name", async () => {
    await prisma.role.upsert({
      where: { name: "curator" },
      update: {},
      create: { name: "curator", description: "Curator" },
    });

    await prisma.user.create({
      data: {
        id: mockUserId,
        email: "curator@test.com",
        username: "curator",
        roles: { connect: { name: "curator" } },
      },
    });

    // Create service (use upsert)
    const service = await prisma.service.upsert({
      where: { name: "test" },
      update: {},
      create: {
        name: "test",
        displayName: "Test",
        baseUrl: "http://test.com",
        isActive: true,
      },
    });

    const artist1 = await prisma.artist.create({
      data: {
        name: "Artist 1",
        normalizedName: "artist1",
      },
    });

    const artist2 = await prisma.artist.create({
      data: {
        name: "Artist 2",
        normalizedName: "artist2",
      },
    });

    // Same album name but different artists - should NOT be grouped
    const album1 = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist1.id,
      },
    });

    const album2 = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist2.id,
      },
    });

    // Create tracks
    await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: artist1.id,
        albumId: album1.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    await prisma.track.create({
      data: {
        title: "Track 2",
        artistId: artist2.id,
        albumId: album2.id,
        serviceId: service.id,
        externalId: "track2",
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    // No duplicates because they have different artists
    expect(data.groups).toHaveLength(0);
  });

  test("returns empty array when no duplicates", async () => {
    await prisma.role.upsert({
      where: { name: "curator" },
      update: {},
      create: { name: "curator", description: "Curator" },
    });

    await prisma.user.create({
      data: {
        id: mockUserId,
        email: "curator@test.com",
        username: "curator",
        roles: { connect: { name: "curator" } },
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    await prisma.album.create({
      data: {
        name: "Unique Album",
        artistId: artist.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    expect(data.groups).toHaveLength(0);
  });
});
