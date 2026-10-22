import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { action } from "./artists.merge.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("POST /api/metadata/artists/merge", () => {
  let mockUserId: string;

  beforeEach(async () => {
    mockUserId = "test-user-id";
    vi.mocked(requireUserId).mockResolvedValue(mockUserId);
    await prisma.track.deleteMany();
    await prisma.album.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("curator can merge artists", async () => {
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

    // Create service first (use upsert to avoid conflicts)
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

    const sourceArtist = await prisma.artist.create({
      data: {
        name: "Duplicate Artist",
        normalizedName: "duplicateartist",
      },
    });

    const targetArtist = await prisma.artist.create({
      data: {
        name: "Main Artist",
        normalizedName: "mainartist",
      },
    });

    // Create tracks for source artist
    const track1 = await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: sourceArtist.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    const track2 = await prisma.track.create({
      data: {
        title: "Track 2",
        artistId: sourceArtist.id,
        serviceId: service.id,
        externalId: "track2",
      },
    });

    // Create album for source artist
    const album = await prisma.album.create({
      data: {
        name: "Album 1",
        artistId: sourceArtist.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/artists/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: sourceArtist.id,
        targetId: targetArtist.id,
        keepAsAlias: false,
        comment: "Merging duplicate artists",
      }),
    });

    const result = await action({ request, params: {} } as any);
    const data = result.data;

    expect(data.success).toBe(true);
    expect(data.tracksUpdated).toBe(2);
    expect(data.albumsUpdated).toBe(1);
    expect(data.targetArtist.id).toBe(targetArtist.id);

    // Verify tracks were moved
    const updatedTrack1 = await prisma.track.findUnique({ where: { id: track1.id } });
    const updatedTrack2 = await prisma.track.findUnique({ where: { id: track2.id } });
    expect(updatedTrack1?.artistId).toBe(targetArtist.id);
    expect(updatedTrack2?.artistId).toBe(targetArtist.id);

    // Verify album was moved
    const updatedAlbum = await prisma.album.findUnique({ where: { id: album.id } });
    expect(updatedAlbum?.artistId).toBe(targetArtist.id);

    // Verify source artist is marked as merged
    const mergedArtist = await prisma.artist.findUnique({ where: { id: sourceArtist.id } });
    expect(mergedArtist?.mergedIntoId).toBe(targetArtist.id);
    expect(mergedArtist?.mergedAt).toBeDefined();
    expect(mergedArtist?.mergedBy).toBe(curator.id);
  });

  test("prevents self-merge", async () => {
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

    const request = new Request("http://localhost/api/metadata/artists/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: artist.id,
        targetId: artist.id,
        keepAsAlias: false,
        comment: "Trying self-merge",
      }),
    });

    await expect(action({ request, params: {} } as any)).rejects.toThrow();
  });

  test("prevents circular merge (target already merged)", async () => {
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

    const artist3 = await prisma.artist.create({
      data: {
        name: "Artist 3",
        normalizedName: "artist3",
        mergedIntoId: artist1.id,
        mergedAt: new Date(),
        mergedBy: curator.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/artists/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: artist2.id,
        targetId: artist3.id,
        keepAsAlias: false,
        comment: "Trying circular merge",
      }),
    });

    await expect(action({ request, params: {} } as any)).rejects.toThrow();
  });

  test("requires comment field", async () => {
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

    const request = new Request("http://localhost/api/metadata/artists/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: artist1.id,
        targetId: artist2.id,
        keepAsAlias: false,
      }),
    });

    await expect(action({ request, params: {} } as any)).rejects.toThrow();
  });

  test("regular user cannot merge artists", async () => {
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });

    await prisma.user.create({
      data: {
        id: mockUserId,
        email: "user@test.com",
        username: "user",
        roles: { connect: { name: "user" } },
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

    const request = new Request("http://localhost/api/metadata/artists/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: artist1.id,
        targetId: artist2.id,
        keepAsAlias: false,
        comment: "Trying to merge",
      }),
    });

    await expect(action({ request, params: {} } as any)).rejects.toThrow();
  });
});
