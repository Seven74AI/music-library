import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";

describe("UserPlaylist title uniqueness (DB-level guard)", () => {
  beforeEach(async () => {
    await prisma.userPlaylistTrack.deleteMany();
    await prisma.userPlaylist.deleteMany();
  });

  test("rejects a case-insensitive duplicate title for the same owner", async () => {
    const user = await prisma.user.create({ data: createUser() });
    await prisma.userPlaylist.create({ data: { title: "Road Trip", ownerId: user.id } });

    await expect(
      prisma.userPlaylist.create({ data: { title: "road trip", ownerId: user.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  test("allows the same title for different owners", async () => {
    const alice = await prisma.user.create({ data: createUser() });
    const bob = await prisma.user.create({ data: createUser() });
    await prisma.userPlaylist.create({ data: { title: "Road Trip", ownerId: alice.id } });

    await expect(
      prisma.userPlaylist.create({ data: { title: "Road Trip", ownerId: bob.id } }),
    ).resolves.toMatchObject({ title: "Road Trip", ownerId: bob.id });
  });
});
