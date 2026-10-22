import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { action } from "./albums.$id.edit.tsx";
import { action as restoreAction } from "./albums+/$id.restore.$editId.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("POST /api/metadata/albums/:id/edit", () => {
  let mockUserId: string;

  beforeEach(async () => {
    mockUserId = "test-user-id";
    vi.mocked(requireUserId).mockResolvedValue(mockUserId);
    await prisma.album.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.editLock.deleteMany();
    await prisma.user.deleteMany();
  });

  test("curator can edit album", async () => {
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
        name: "Original Album",
        artistId: artist.id,
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Album",
        artistId: artist.id,
        year: 2024,
        comment: "Fixing album name",
      }),
    });

    const result = await action({ request, params: { id: album.id } } as any);
    const data = result.data;

    expect(data.album.name).toBe("Updated Album");
    expect(data.album.year).toBe(2024);
    expect(data.edit).toBeDefined();
    expect(data.edit.comment).toBe("Fixing album name");
    expect(data.edit.editedBy).toBe(mockUserId);

    const albumInDb = await prisma.album.findUnique({ where: { id: album.id } });
    expect(albumInDb?.name).toBe("Updated Album");
    expect(albumInDb?.year).toBe(2024);
  });

  test("can change album artist", async () => {
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

    const album = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist1.id,
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Album",
        artistId: artist2.id,
        comment: "Moving to correct artist",
      }),
    });

    const result = await action({ request, params: { id: album.id } } as any);
    const data = result.data;

    expect(data.album.artistId).toBe(artist2.id);

    const albumInDb = await prisma.album.findUnique({ where: { id: album.id } });
    expect(albumInDb?.artistId).toBe(artist2.id);
  });

  test("regular user cannot edit album", async () => {
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

    const album = await prisma.album.create({
      data: {
        name: "Album",
        artistId: artist.id,
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Album",
        artistId: artist.id,
        comment: "Trying to edit",
      }),
    });

    await expect(action({ request, params: { id: album.id } } as any)).rejects.toThrow();
  });

  test("requires name and artistId fields", async () => {
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

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        year: 2024,
      }),
    });

    await expect(action({ request, params: { id: album.id } } as any)).rejects.toThrow();
  });

  test("creates edit history entry", async () => {
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
        name: "Original Album",
        artistId: artist.id,
        year: 2020,
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Album",
        artistId: artist.id,
        year: 2024,
        comment: "Test edit",
      }),
    });

    await action({ request, params: { id: album.id } } as any);

    const edits = await prisma.albumEdit.findMany({
      where: { albumId: album.id },
      orderBy: { editedAt: "desc" },
    });

    expect(edits).toHaveLength(1);
    expect(edits[0]?.name).toBe("Original Album");
    expect(edits[0]?.year).toBe(2020);
    expect(edits[0]?.comment).toBe("Test edit");
  });

  test("restore can recover the pre-edit album snapshot", async () => {
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

    const otherArtist = await prisma.artist.create({
      data: {
        name: "Other Artist",
        normalizedName: "otherartist",
      },
    });

    const album = await prisma.album.create({
      data: {
        name: "Abbey Road",
        artistId: artist.id,
        year: 1969,
      },
    });

    const editResult = await action({
      request: new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Wrong Title",
          artistId: otherArtist.id,
          year: 1970,
          comment: "Bad reassign",
        }),
      }),
      params: { id: album.id },
    } as any);

    expect(editResult.data.album.name).toBe("Wrong Title");
    expect(editResult.data.edit.name).toBe("Abbey Road");
    expect(editResult.data.edit.artistId).toBe(artist.id);
    expect(editResult.data.edit.year).toBe(1969);

    const restoreResult = await restoreAction({
      request: new Request(
        `http://localhost/api/metadata/albums/${album.id}/restore/${editResult.data.edit.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: "Undo the bad reassign" }),
        },
      ),
      params: { id: album.id, editId: editResult.data.edit.id },
    } as any);

    expect(restoreResult.data.album.name).toBe("Abbey Road");
    expect(restoreResult.data.album.artistId).toBe(artist.id);
    expect(restoreResult.data.album.year).toBe(1969);

    const albumInDb = await prisma.album.findUnique({ where: { id: album.id } });
    expect(albumInDb?.name).toBe("Abbey Road");
    expect(albumInDb?.artistId).toBe(artist.id);
    expect(albumInDb?.year).toBe(1969);
  });

  test("saves the CoverImage id as the album cover", async () => {
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

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const originalCover = await prisma.coverImage.create({
      data: {
        contentHash: `original-${suffix}`,
        objectKey: `images/albums/original-${suffix}.jpg`,
        format: "jpeg",
      },
    });
    const uploadedCover = await prisma.coverImage.create({
      data: {
        contentHash: `uploaded-${suffix}`,
        objectKey: `images/albums/uploaded-${suffix}.jpg`,
        format: "jpeg",
      },
    });

    const album = await prisma.album.create({
      data: {
        name: "Original Album",
        artistId: artist.id,
        year: 1969,
        coverImageId: originalCover.id,
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Original Album",
        artistId: artist.id,
        year: 1969,
        coverImageId: uploadedCover.id,
        comment: "New cover",
      }),
    });

    const result = await action({ request, params: { id: album.id } } as any);
    expect(result.data.album.coverImageId).toBe(uploadedCover.id);
    expect(result.data.edit.coverImageId).toBe(originalCover.id);

    const albumInDb = await prisma.album.findUnique({
      where: { id: album.id },
      include: { coverImage: true },
    });
    expect(albumInDb?.coverImageId).toBe(uploadedCover.id);
    expect(albumInDb?.coverImage?.id).toBe(uploadedCover.id);
    expect(albumInDb?.coverImage?.objectKey).toBe(uploadedCover.objectKey);
  });

  test("returns 404 for non-existent album", async () => {
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

    const request = new Request("http://localhost/api/metadata/albums/nonexistent/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Album",
        artistId: artist.id,
      }),
    });

    await expect(action({ request, params: { id: "nonexistent" } } as any)).rejects.toThrow();
  });

  test("rejects edit when another curator holds the lock", async () => {
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

    const otherUser = await prisma.user.create({
      data: {
        id: "other-user",
        email: "other@test.com",
        username: "other",
        name: "Ada",
        roles: { connect: { name: "curator" } },
      },
    });

    const artist = await prisma.artist.create({
      data: { name: "Artist", normalizedName: "artist" },
    });

    const album = await prisma.album.create({
      data: { name: "Album", artistId: artist.id },
    });

    await prisma.editLock.create({
      data: {
        entityType: "album",
        entityId: album.id,
        lockedBy: otherUser.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Overwrite", artistId: artist.id }),
    });

    await expect(action({ request, params: { id: album.id } } as any)).rejects.toMatchObject({
      data: { error: "Locked", message: "Ada is currently editing this album" },
      init: { status: 409 },
    });
  });

  test("releases the lock after a successful save", async () => {
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
      data: { name: "Artist", normalizedName: "artist" },
    });

    const album = await prisma.album.create({
      data: { name: "Album", artistId: artist.id },
    });

    await prisma.editLock.create({
      data: {
        entityType: "album",
        entityId: album.id,
        lockedBy: mockUserId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const request = new Request(`http://localhost/api/metadata/albums/${album.id}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", artistId: artist.id }),
    });

    await action({ request, params: { id: album.id } } as any);

    const lock = await prisma.editLock.findUnique({
      where: { entityType_entityId: { entityType: "album", entityId: album.id } },
    });
    expect(lock).toBeNull();
  });
});
