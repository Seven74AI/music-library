import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { promoteOnRepeatSnapshot } from "./promote.server.ts";

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

describe("promoteOnRepeatSnapshot", () => {
  beforeEach(async () => {
    await prisma.userPlaylistTrack.deleteMany();
    await prisma.userPlaylist.deleteMany();
    await prisma.onRepeatSnapshotTrack.deleteMany();
    await prisma.onRepeatSnapshot.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("creates a new UserPlaylist with all snapshot tracks", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const trackA = await createTrack("A");
    const trackB = await createTrack("B");
    const snapshot = await prisma.onRepeatSnapshot.create({
      data: {
        userId: user.id,
        yearMonth: "2026-08",
        tracks: {
          create: [
            { trackId: trackA.id, position: 0, listenCount: 5 },
            { trackId: trackB.id, position: 1, listenCount: 3 },
          ],
        },
      },
    });

    const result = await promoteOnRepeatSnapshot({
      userId: user.id,
      snapshotId: snapshot.id,
      mode: "create",
      title: "August On Repeat",
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(result.addedCount).toBe(2);
    expect(result.playlist.title).toBe("August On Repeat");

    const members = await prisma.userPlaylistTrack.findMany({
      where: { playlistId: result.playlist.id },
      orderBy: { position: "asc" },
    });
    expect(members.map((m) => m.trackId)).toEqual([trackA.id, trackB.id]);

    // Snapshot unchanged
    expect(await prisma.onRepeatSnapshotTrack.count({ where: { snapshotId: snapshot.id } })).toBe(
      2,
    );
  });

  test("adds to an existing UserPlaylist skipping duplicates", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const trackA = await createTrack("A");
    const trackB = await createTrack("B");
    const playlist = await prisma.userPlaylist.create({
      data: {
        title: "Favorites",
        ownerId: user.id,
        tracks: { create: [{ trackId: trackA.id, position: 0 }] },
      },
    });
    const snapshot = await prisma.onRepeatSnapshot.create({
      data: {
        userId: user.id,
        yearMonth: "2026-08",
        tracks: {
          create: [
            { trackId: trackA.id, position: 0, listenCount: 5 },
            { trackId: trackB.id, position: 1, listenCount: 3 },
          ],
        },
      },
    });

    const result = await promoteOnRepeatSnapshot({
      userId: user.id,
      snapshotId: snapshot.id,
      mode: "add",
      targetPlaylistId: playlist.id,
    });

    expect(result).toMatchObject({
      status: "success",
      addedCount: 1,
      skippedCount: 1,
    });
    const members = await prisma.userPlaylistTrack.findMany({
      where: { playlistId: playlist.id },
      orderBy: { position: "asc" },
    });
    expect(members.map((m) => m.trackId)).toEqual([trackA.id, trackB.id]);
  });

  test("rejects promote of another user's snapshot", async () => {
    const owner = await prisma.user.create({ data: createUser() });
    const other = await prisma.user.create({ data: createUser() });
    const track = await createTrack("A");
    const snapshot = await prisma.onRepeatSnapshot.create({
      data: {
        userId: owner.id,
        yearMonth: "2026-08",
        tracks: { create: [{ trackId: track.id, position: 0, listenCount: 1 }] },
      },
    });

    const result = await promoteOnRepeatSnapshot({
      userId: other.id,
      snapshotId: snapshot.id,
      mode: "create",
      title: "Stolen",
    });
    expect(result.status).toBe("not_found");
  });
});
