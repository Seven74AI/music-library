import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { action } from "./albums.merge.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("POST /api/metadata/albums/merge", () => {
  let mockUserId: string;

  beforeEach(async () => {
    mockUserId = "test-user-id";
    vi.mocked(requireUserId).mockResolvedValue(mockUserId);
    await prisma.track.deleteMany();
    await prisma.album.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("curator can merge albums", async () => {
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

    // Create service first (use upsert)
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

    const sourceAlbum = await prisma.album.create({
      data: {
        name: "Duplicate Album",
        artistId: artist.id,
      },
    });

    const targetAlbum = await prisma.album.create({
      data: {
        name: "Main Album",
        artistId: artist.id,
      },
    });

    // Create tracks for source album
    const track1 = await prisma.track.create({
      data: {
        title: "Track 1",
        artistId: artist.id,
        albumId: sourceAlbum.id,
        serviceId: service.id,
        externalId: "track1",
      },
    });

    const track2 = await prisma.track.create({
      data: {
        title: "Track 2",
        artistId: artist.id,
        albumId: sourceAlbum.id,
        serviceId: service.id,
        externalId: "track2",
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: sourceAlbum.id,
        targetId: targetAlbum.id,
        keepAsAlias: false,
        comment: "Merging duplicate albums",
      }),
    });

    const result = await action({ request, params: {} } as any);
    const data = result.data;

    expect(data.success).toBe(true);
    expect(data.tracksUpdated).toBe(2);
    expect(data.targetAlbum.id).toBe(targetAlbum.id);

    // Verify tracks were moved
    const updatedTrack1 = await prisma.track.findUnique({ where: { id: track1.id } });
    const updatedTrack2 = await prisma.track.findUnique({ where: { id: track2.id } });
    expect(updatedTrack1?.albumId).toBe(targetAlbum.id);
    expect(updatedTrack2?.albumId).toBe(targetAlbum.id);

    // Verify source album is marked as merged
    const mergedAlbum = await prisma.album.findUnique({ where: { id: sourceAlbum.id } });
    expect(mergedAlbum?.mergedIntoId).toBe(targetAlbum.id);
    expect(mergedAlbum?.mergedAt).toBeDefined();
    expect(mergedAlbum?.mergedBy).toBe(mockUserId);
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

    const album = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: album.id,
        targetId: album.id,
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

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    const album1 = await prisma.album.create({
      data: {
        name: "Album 1",
        artistId: artist.id,
      },
    });

    const album2 = await prisma.album.create({
      data: {
        name: "Album 2",
        artistId: artist.id,
      },
    });

    const album3 = await prisma.album.create({
      data: {
        name: "Album 3",
        artistId: artist.id,
        mergedIntoId: album1.id,
        mergedAt: new Date(),
        mergedBy: curator.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: album2.id,
        targetId: album3.id,
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

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    const album1 = await prisma.album.create({
      data: {
        name: "Album 1",
        artistId: artist.id,
      },
    });

    const album2 = await prisma.album.create({
      data: {
        name: "Album 2",
        artistId: artist.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: album1.id,
        targetId: album2.id,
        keepAsAlias: false,
      }),
    });

    await expect(action({ request, params: {} } as any)).rejects.toThrow();
  });

  test("regular user cannot merge albums", async () => {
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

    const artist = await prisma.artist.create({
      data: {
        name: "Artist",
        normalizedName: "artist",
      },
    });

    const album1 = await prisma.album.create({
      data: {
        name: "Album 1",
        artistId: artist.id,
      },
    });

    const album2 = await prisma.album.create({
      data: {
        name: "Album 2",
        artistId: artist.id,
      },
    });

    const request = new Request("http://localhost/api/metadata/albums/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: album1.id,
        targetId: album2.id,
        keepAsAlias: false,
        comment: "Trying to merge",
      }),
    });

    await expect(action({ request, params: {} } as any)).rejects.toThrow();
  });
});
