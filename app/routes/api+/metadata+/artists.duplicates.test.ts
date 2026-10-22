import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { loader } from "./artists.duplicates.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("GET /api/metadata/artists/duplicates", () => {
  let mockUserId: string;

  beforeEach(async () => {
    mockUserId = "test-user-id";
    vi.mocked(requireUserId).mockResolvedValue(mockUserId);
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("curator can find duplicate artists", async () => {
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

    // Create artists with same normalized name
    const artist1 = await prisma.artist.create({
      data: {
        name: "The Beatles",
        normalizedName: "thebeatles",
      },
    });

    const artist2 = await prisma.artist.create({
      data: {
        name: "The Beatles",
        normalizedName: "thebeatles",
      },
    });

    // Create tracks for each artist
    await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: artist1.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    await prisma.track.create({
      data: {
        title: "Track 2",
        artistId: artist1.id,
        serviceId: service.id,
        externalId: "track2",
      },
    });

    await prisma.track.create({
      data: {
        title: "Track 3",
        artistId: artist2.id,
        serviceId: service.id,
        externalId: "track3",
      },
    });

    // Add another track to artist2 so both have >= 2 tracks (default minTracks)
    await prisma.track.create({
      data: {
        title: "Track 4",
        artistId: artist2.id,
        serviceId: service.id,
        externalId: "track4",
      },
    });

    const request = new Request("http://localhost/api/metadata/artists/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]?.normalizedName).toBe("thebeatles");
    expect(data.groups[0]?.artists).toHaveLength(2);

    const artists = data.groups[0]?.artists;
    expect(artists?.some((a: any) => a.id === artist1.id && a.trackCount === 2)).toBe(true);
    expect(artists?.some((a: any) => a.id === artist2.id && a.trackCount === 2)).toBe(true);
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

    // Create artists with same normalized name
    const artist1 = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    const artist2 = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    // Create 2 tracks for artist1 (meets threshold)
    for (let i = 1; i <= 2; i++) {
      await prisma.track.create({
        data: {
          title: `Track ${i}`,
          artistId: artist1.id,
          serviceId: service.id,
          externalId: `track${i}`,
        },
      });
    }

    // Create 3 tracks for artist2 (meets threshold)
    for (let i = 3; i <= 5; i++) {
      await prisma.track.create({
        data: {
          title: `Track ${i}`,
          artistId: artist2.id,
          serviceId: service.id,
          externalId: `track${i}`,
        },
      });
    }

    const request = new Request("http://localhost/api/metadata/artists/duplicates?minTracks=2", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    expect(data.groups).toHaveLength(1);

    const artists = data.groups[0]?.artists;
    // Both artists should be included (both have >= 2 tracks)
    expect(artists?.length).toBe(2);
    expect(artists?.some((a: any) => a.id === artist1.id && a.trackCount === 2)).toBe(true);
    expect(artists?.some((a: any) => a.id === artist2.id && a.trackCount === 3)).toBe(true);
  });

  test("excludes merged artists", async () => {
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

    const artist1 = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
        mergedIntoId: artist1.id,
        mergedAt: new Date(),
        mergedBy: curator.id,
      },
    });

    // Create tracks
    await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: artist1.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    const request = new Request("http://localhost/api/metadata/artists/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    // No duplicates since merged artist is excluded
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

    await prisma.artist.create({
      data: {
        name: "Unique Artist",
        normalizedName: "uniqueartist",
      },
    });

    const request = new Request("http://localhost/api/metadata/artists/duplicates", {
      method: "GET",
    });

    const result = await loader({ request, params: {} } as any);
    const data = result.data;

    expect(data.groups).toHaveLength(0);
  });
});
