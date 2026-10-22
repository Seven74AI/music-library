import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { action } from "./artists.$id.edit.tsx";
import { action as restoreAction } from "./artists+/$id.restore.$editId.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("POST /api/metadata/artists/:id/edit", () => {
  let mockUserId: string;

  beforeEach(async () => {
    mockUserId = "test-user-id";
    vi.mocked(requireUserId).mockResolvedValue(mockUserId);
    await prisma.user.deleteMany();
    await prisma.editLock.deleteMany();
    await prisma.artist.deleteMany();
  });

  test("curator can edit artist", async () => {
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
        name: "Original Name",
        normalizedName: "originalname",
      },
    });

    const request = new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
        bio: "New bio",
        genre: "Rock",
        comment: "Fixing artist name",
      }),
    });

    const result = await action({ request, params: { id: artist.id } } as any);
    const data = result.data;

    expect(data.artist.name).toBe("Updated Name");
    expect(data.artist.normalizedName).toBe("updated name");
    expect(data.artist.bio).toBe("New bio");
    expect(data.artist.genre).toBe("Rock");
    expect(data.edit).toBeDefined();
    expect(data.edit.comment).toBe("Fixing artist name");
    expect(data.edit.editedBy).toBe(curator.id);

    const artistInDb = await prisma.artist.findUnique({ where: { id: artist.id } });
    expect(artistInDb?.name).toBe("Updated Name");
  });

  test("regular user cannot edit artist", async () => {
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });

    const user = await prisma.user.create({
      data: {
        id: mockUserId,
        email: "user@test.com",
        username: "user",
        roles: { connect: { name: "user" } },
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Original Name",
        normalizedName: "originalname",
      },
    });

    const request = new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
        comment: "Trying to edit",
      }),
    });

    await expect(action({ request, params: { id: artist.id } } as any)).rejects.toThrow();
  });

  test("requires name field", async () => {
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
        name: "Original Name",
        normalizedName: "originalname",
      },
    });

    const request = new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bio: "New bio",
      }),
    });

    await expect(action({ request, params: { id: artist.id } } as any)).rejects.toThrow();
  });

  test("creates edit history entry", async () => {
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
        name: "Original Name",
        normalizedName: "originalname",
        bio: "Original bio",
      },
    });

    const request = new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
        bio: "Updated bio",
        comment: "Test edit",
      }),
    });

    await action({ request, params: { id: artist.id } } as any);

    const edits = await prisma.artistEdit.findMany({
      where: { artistId: artist.id },
      orderBy: { editedAt: "desc" },
    });

    expect(edits).toHaveLength(1);
    expect(edits[0]?.name).toBe("Original Name");
    expect(edits[0]?.bio).toBe("Original bio");
    expect(edits[0]?.comment).toBe("Test edit");
  });

  test("restore can recover the pre-edit artist snapshot", async () => {
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
        name: "The Beatles",
        normalizedName: "thebeatles",
        bio: "British rock band",
        genre: "Rock",
        country: "UK",
      },
    });

    const editResult = await action({
      request: new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Beatles",
          bio: "Wrong bio",
          genre: "Pop",
          country: "US",
          comment: "Bad rename",
        }),
      }),
      params: { id: artist.id },
    } as any);

    expect(editResult.data.artist.name).toBe("Beatles");
    expect(editResult.data.edit.name).toBe("The Beatles");

    const restoreResult = await restoreAction({
      request: new Request(
        `http://localhost/api/metadata/artists/${artist.id}/restore/${editResult.data.edit.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: "Undo the bad rename" }),
        },
      ),
      params: { id: artist.id, editId: editResult.data.edit.id },
    } as any);

    expect(restoreResult.data.artist.name).toBe("The Beatles");
    expect(restoreResult.data.artist.bio).toBe("British rock band");
    expect(restoreResult.data.artist.genre).toBe("Rock");
    expect(restoreResult.data.artist.country).toBe("UK");

    const artistInDb = await prisma.artist.findUnique({ where: { id: artist.id } });
    expect(artistInDb?.name).toBe("The Beatles");
    expect(artistInDb?.bio).toBe("British rock band");
  });

  test("returns 404 for non-existent artist", async () => {
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

    const request = new Request("http://localhost/api/metadata/artists/nonexistent/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
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
      data: { name: "Original Name", normalizedName: "originalname" },
    });

    await prisma.editLock.create({
      data: {
        entityType: "artist",
        entityId: artist.id,
        lockedBy: otherUser.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const request = new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Overwrite" }),
    });

    await expect(action({ request, params: { id: artist.id } } as any)).rejects.toMatchObject({
      data: { error: "Locked", message: "Ada is currently editing this artist" },
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
      data: { name: "Original Name", normalizedName: "originalname" },
    });

    await prisma.editLock.create({
      data: {
        entityType: "artist",
        entityId: artist.id,
        lockedBy: mockUserId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const request = new Request(`http://localhost/api/metadata/artists/${artist.id}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    });

    await action({ request, params: { id: artist.id } } as any);

    const lock = await prisma.editLock.findUnique({
      where: { entityType_entityId: { entityType: "artist", entityId: artist.id } },
    });
    expect(lock).toBeNull();
  });
});
