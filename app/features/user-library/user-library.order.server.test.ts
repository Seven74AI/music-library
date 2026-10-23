import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser, resetUsageAnalyticsTables } from "#tests/db-utils.ts";
import { addTracksToUserLibrary } from "./user-library.server.ts";

vi.mock("#app/features/usage-analytics/record-usage.server.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#app/features/usage-analytics/record-usage.server.ts")>();
  return {
    ...actual,
    recordUsageEvent: vi.fn().mockResolvedValue(undefined),
  };
});

async function createTrack(title: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
}

describe("addTracksToUserLibrary playlist order", () => {
  beforeEach(async () => {
    await resetUsageAnalyticsTables();
    await prisma.trackAudioFile.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("library dateAdded order matches playlist order (not reverse)", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const first = await createTrack("Playlist Position 1");
    const second = await createTrack("Playlist Position 2");
    const third = await createTrack("Playlist Position 3");

    // Same order as YouTube playlist / Add All Missing form fields
    const result = await addTracksToUserLibrary([first.id, second.id, third.id], user.id);
    expect(result.success).toBe(true);
    expect(result.addedCount).toBe(3);

    const library = await prisma.userTrack.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { trackId: true, createdAt: true },
    });

    expect(library.map((row) => row.trackId)).toEqual([first.id, second.id, third.id]);
    expect(library[0]!.createdAt.getTime()).toBeGreaterThan(library[1]!.createdAt.getTime());
    expect(library[1]!.createdAt.getTime()).toBeGreaterThan(library[2]!.createdAt.getTime());
  });

  test("re-added soft-deleted track keeps playlist position when mixed with new tracks", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const oldTrack = await createTrack("Old Track");
    const newTrack = await createTrack("New Track");

    // Old track added earlier, then soft-deleted.
    await addTracksToUserLibrary([oldTrack.id], user.id);
    await prisma.userTrack.updateMany({
      where: { userId: user.id, trackId: oldTrack.id },
      data: { isActive: false, deletedAt: new Date() },
    });

    // Bulk re-add playlist [old, new]: old is reactivated, new is created.
    const result = await addTracksToUserLibrary([oldTrack.id, newTrack.id], user.id);
    expect(result.success).toBe(true);
    expect(result.addedCount).toBe(2);

    const library = await prisma.userTrack.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { trackId: true, createdAt: true },
    });

    // Reactivated old track must be re-stamped newest, not keep its old stamp
    // and sort below the new track (out of playlist order).
    expect(library.map((row) => row.trackId)).toEqual([oldTrack.id, newTrack.id]);
    expect(library[0]!.createdAt.getTime()).toBeGreaterThan(library[1]!.createdAt.getTime());
  });
});
