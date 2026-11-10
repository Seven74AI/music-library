import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import {
  findSurplusSptIds,
  loadPlaylistTracksForOrphanDetection,
  processTracksInBatches,
  type ProcessedIdSets,
  type SyncableItem,
} from "./batch-processor.server";
import { createYouTubeTrackSyncProcessor } from "./youtube-track-sync.server";

const item = (id: string | undefined, videoId: string): SyncableItem => ({
  ...(id ? { id } : {}),
  snippet: {
    title: `Title ${videoId}`,
    resourceId: { videoId },
    videoOwnerChannelTitle: "Uploader",
    thumbnails: { default: { url: "https://example.com/t.jpg" } },
  },
});

const emptyIds = (): ProcessedIdSets => ({
  externalIds: new Set(),
  trackIds: new Set(),
  sptIds: new Set(),
});

describe("ServicePlaylistTrack keyed by playlistItem.id", () => {
  let playlistId: string;
  let serviceId: string;

  async function sync(items: SyncableItem[]) {
    const processor = createYouTubeTrackSyncProcessor();
    const ids = emptyIds();
    const result = await prisma.$transaction((tx) =>
      processTracksInBatches(
        items,
        serviceId,
        playlistId,
        tx,
        processor,
        noopArchiveEnqueueAdapter,
        0,
        ids,
      ),
    );
    const rows = await loadPlaylistTracksForOrphanDetection(prisma, playlistId);
    return {
      result,
      rows,
      surplus: findSurplusSptIds(rows, result.processedIds),
    };
  }

  beforeEach(async () => {
    await prisma.servicePlaylistTrack.deleteMany();
    await prisma.servicePlaylist.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "youtube" },
      update: {},
      create: {
        name: "youtube",
        displayName: "YouTube",
        baseUrl: "https://youtube.com",
      },
    });
    serviceId = service.id;
    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId,
        externalId: "PL-dupe",
        title: "Dupes",
        itemCount: 0,
        ownerId: user.id,
      },
    });
    playlistId = playlist.id;
  });

  test("same videoId twice yields two rows at distinct positions; re-sync keeps both", async () => {
    const items = [item("pi-1", "vid-a"), item("pi-2", "vid-b"), item("pi-3", "vid-a")];
    const first = await sync(items);
    expect(first.result.processedCount).toBe(3);
    expect(first.rows).toHaveLength(3);
    const copies = first.rows.filter((r) => r.track.externalId === "vid-a");
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((r) => r.position)).size).toBe(2);
    const firstIds = new Set(first.rows.map((r) => r.id));

    const second = await sync(items);
    expect(second.result.processedCount).toBe(3);
    expect(second.rows).toHaveLength(3);
    expect(new Set(second.rows.map((r) => r.id))).toEqual(firstIds);
    expect(second.surplus.size).toBe(0);
  });

  test("legacy NULL rows are lazily stamped, not duplicated", async () => {
    await sync([item(undefined, "vid-a")]);
    const legacy = await prisma.servicePlaylistTrack.findMany({
      where: { playlistId },
    });
    expect(legacy[0]!.playlistItemId).toBeNull();

    const { rows } = await sync([item("pi-1", "vid-a")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(legacy[0]!.id);
    const stamped = await prisma.servicePlaylistTrack.findUniqueOrThrow({
      where: { id: legacy[0]!.id },
    });
    expect(stamped.playlistItemId).toBe("pi-1");
  });

  test("regenerated playlistItem.id reuses the row (no double rows)", async () => {
    await sync([item("pi-1", "vid-a"), item("pi-2", "vid-a")]);
    const { rows, surplus } = await sync([item("pi-9", "vid-a"), item("pi-2", "vid-a")]);
    expect(rows).toHaveLength(2);
    expect(surplus.size).toBe(0);
  });

  test("removing one of two copies marks only the surplus row, keeps the other", async () => {
    await sync([item("pi-1", "vid-a"), item("pi-2", "vid-a")]);
    const { rows, surplus } = await sync([item("pi-2", "vid-a")]);
    expect(rows).toHaveLength(2);
    expect(surplus.size).toBe(1);
    const kept = rows.find((r) => !surplus.has(r.id))!;
    expect(
      (
        await prisma.servicePlaylistTrack.findUniqueOrThrow({
          where: { id: kept.id },
        })
      ).playlistItemId,
    ).toBe("pi-2");
  });
});
