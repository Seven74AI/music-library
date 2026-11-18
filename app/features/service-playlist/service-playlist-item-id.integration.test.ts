import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { findSurplusSptIds, loadPlaylistTracksForOrphanDetection } from "./orphan-detection.server";
import {
  resolveDeletedVideosAfterSync,
  processTracksInBatches,
  type ProcessedIdSets,
  type SyncableItem,
} from "./batch-processor.server";
import { createYouTubeTrackSyncProcessor } from "./youtube-track-sync.server";

type TrackSyncProcessor = ReturnType<typeof createYouTubeTrackSyncProcessor>;

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
  failedExternalIds: new Set(),
});

describe("ServicePlaylistTrack keyed by playlistItem.id", () => {
  let playlistId: string;
  let serviceId: string;

  async function sync(
    items: SyncableItem[],
    processor: TrackSyncProcessor = createYouTubeTrackSyncProcessor(),
  ) {
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
    const before = await sync([item("pi-1", "vid-a"), item("pi-2", "vid-a")]);
    const { rows, surplus } = await sync([item("pi-9", "vid-a"), item("pi-2", "vid-a")]);
    expect(rows).toHaveLength(2);
    expect(surplus.size).toBe(0);
    // The regenerated id REUSED the existing row rather than creating a new one.
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(before.rows.map((r) => r.id)));
    const stamped = await prisma.servicePlaylistTrack.findMany({
      where: { playlistId },
    });
    expect(stamped.map((r) => r.playlistItemId).sort()).toEqual(["pi-2", "pi-9"]);
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

  test("duplicate playlistItem.id in one payload does not fail and yields one row", async () => {
    const { result, rows } = await sync([
      item("pi-1", "vid-a"),
      item("pi-1", "vid-a"),
      item("pi-2", "vid-b"),
    ]);
    expect(rows).toHaveLength(2);
    expect(result.processedCount).toBe(2);
    expect(rows.filter((r) => r.track.externalId === "vid-a")).toHaveLength(1);
  });

  test("a failed-preparation copy is not deleted as surplus", async () => {
    await sync([item("pi-1", "vid-a"), item("pi-2", "vid-a")]);
    const base = createYouTubeTrackSyncProcessor();
    const flaky = Object.create(base) as TrackSyncProcessor;
    flaky.transformPlaylistItem = (it, serviceId, artistId) => {
      if (it.id === "pi-2") throw new Error("boom");
      return base.transformPlaylistItem(it, serviceId, artistId);
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rows, surplus } = await sync([item("pi-1", "vid-a"), item("pi-2", "vid-a")], flaky);
    errorSpy.mockRestore();
    expect(rows).toHaveLength(2);
    expect(surplus.size).toBe(0);
  });

  test("more than one batch (50) accumulates claimed rows across batches", async () => {
    // Same video repeated 60 times: rows from batch 1 must not be re-claimed in batch 2.
    const items = Array.from({ length: 60 }, (_, i) => item(`pi-${i}`, "vid-a"));
    const ids = emptyIds();
    const processor = createYouTubeTrackSyncProcessor();
    for (const start of [0, 50]) {
      const slice = items.slice(start, start + 50);
      const res = await prisma.$transaction((tx) =>
        processTracksInBatches(
          slice,
          serviceId,
          playlistId,
          tx,
          processor,
          noopArchiveEnqueueAdapter,
          start,
          ids,
        ),
      );
      res.processedIds.sptIds.forEach((id) => ids.sptIds.add(id));
    }
    const rows = await prisma.servicePlaylistTrack.findMany({
      where: { playlistId },
    });
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => r.playlistItemId)).size).toBe(60);
    // Re-sync in one call (two internal batches of 50) is stable.
    const again = await sync(items);
    expect(again.rows).toHaveLength(60);
    expect(again.surplus.size).toBe(0);
  });

  test("across transaction slices a row owned by a later slice's item is not restamped", async () => {
    // "pi-late" already owns the row for vid-a. In the payload, "pi-new" (slice 1) also
    // points at vid-a and "pi-late" (slice 2) comes later, as in service-playlist.server.ts.
    await sync([item("pi-late", "vid-a")]);
    const [original] = await prisma.servicePlaylistTrack.findMany({ where: { playlistId } });

    const payload = [item("pi-new", "vid-a"), item("pi-late", "vid-a")];
    const allItemIds = new Set(["pi-new", "pi-late"]);
    const ids = emptyIds();
    const processor = createYouTubeTrackSyncProcessor();
    for (const [start, slice] of [
      [0, payload.slice(0, 1)],
      [1, payload.slice(1)],
    ] as const) {
      const res = await prisma.$transaction((tx) =>
        processTracksInBatches(
          [...slice],
          serviceId,
          playlistId,
          tx,
          processor,
          noopArchiveEnqueueAdapter,
          start,
          ids,
          allItemIds,
        ),
      );
      res.processedIds.sptIds.forEach((id) => ids.sptIds.add(id));
    }

    const rows = await prisma.servicePlaylistTrack.findMany({ where: { playlistId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === original!.id)?.playlistItemId).toBe("pi-late");
    expect(rows.map((r) => r.playlistItemId).sort()).toEqual(["pi-late", "pi-new"]);
  });

  test("a confirmed placeholder is found by the next sync via playlistItemId", async () => {
    const { confirmOrphanedMatches } = await import("./orphaned-match-confirm.server");
    const playlist = await prisma.servicePlaylist.findUniqueOrThrow({
      where: { id: playlistId },
    });
    await confirmOrphanedMatches(
      playlistId,
      [
        {
          deletedItemId: "pi-gone",
          selectedTrackId: null,
          position: 1,
          action: "new",
        },
      ],
      playlist.ownerId,
    );
    const tracksBefore = await prisma.track.count({ where: { serviceId } });
    const placeholder = await prisma.servicePlaylistTrack.findFirstOrThrow({
      where: { playlistId, playlistItemId: "pi-gone" },
    });

    const deletedItem: SyncableItem = {
      id: "pi-gone",
      snippet: { title: "Deleted video", resourceId: { videoId: "" } },
    };
    const { result, rows } = await sync([deletedItem]);

    expect(result.deletedVideosWithoutMatch ?? []).toHaveLength(0);
    expect(await prisma.track.count({ where: { serviceId } })).toBe(tracksBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(placeholder.id);
    expect(rows[0]!.track.id).toBe(placeholder.trackId);
  });
  test("a real track confirmed with `match` is not clobbered by the deleted item on re-sync", async () => {
    const { confirmOrphanedMatches } = await import("./orphaned-match-confirm.server");
    const playlist = await prisma.servicePlaylist.findUniqueOrThrow({
      where: { id: playlistId },
    });
    await sync([item("pi-real", "vid-real")]);
    const real = await prisma.track.findFirstOrThrow({
      where: { serviceId, externalId: "vid-real" },
    });
    const before = { ...real };

    const confirmed = await confirmOrphanedMatches(
      playlistId,
      [
        {
          deletedItemId: "pi-dead",
          selectedTrackId: real.id,
          position: 2,
          action: "match",
        },
      ],
      playlist.ownerId,
    );
    expect(confirmed.success).toBe(true);

    const enqueue = vi.fn(async () => false);
    const deletedItem: SyncableItem = {
      id: "pi-dead",
      snippet: { title: "Deleted video", resourceId: { videoId: "" } },
    };
    const ids = emptyIds();
    await prisma.$transaction((tx) =>
      processTracksInBatches(
        [deletedItem],
        serviceId,
        playlistId,
        tx,
        createYouTubeTrackSyncProcessor(),
        { enqueueArchiveJobs: enqueue },
        0,
        ids,
      ),
    );

    const after = await prisma.track.findUniqueOrThrow({
      where: { id: real.id },
    });
    expect(after.serviceUrl).toBe(before.serviceUrl);
    expect(after.serviceUrl ?? "").not.toContain("pi-dead");
    expect(after.title).toBe(before.title);
    expect(after.externalId).toBe("vid-real");
    expect(after.artistId).toBe(before.artistId);
    expect(await prisma.track.count({ where: { serviceId, externalId: "pi-dead" } })).toBe(0);
    for (const call of enqueue.mock.calls as unknown as Array<[unknown, string[]]>) {
      expect(call[1]).not.toContain(real.id);
    }
    const rows = await prisma.servicePlaylistTrack.findMany({
      where: { playlistId, playlistItemId: "pi-dead" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trackId).toBe(real.id);
  });

  test("regenerated item id: match to the offered candidate, next sync resolves it with no new pending match", async () => {
    const { confirmOrphanedMatches } = await import("./orphaned-match-confirm.server");
    const playlist = await prisma.servicePlaylist.findUniqueOrThrow({
      where: { id: playlistId },
    });
    await sync([item("pi-1", "vid-a"), item("pi-2", "vid-b")]);
    const candidate = await prisma.track.findFirstOrThrow({
      where: { serviceId, externalId: "vid-a" },
    });

    // YouTube regenerated the item id and the video is now unavailable; vid-a is
    // absent from the payload but NOT deleted (stale playlistItemId pi-1).
    const unavailable: SyncableItem = {
      id: "pi-9",
      snippet: { title: "Deleted video", resourceId: { videoId: "" } },
    };
    const payload = [unavailable, item("pi-2", "vid-b")];
    const first = await sync(payload);
    const resolved = await resolveDeletedVideosAfterSync(
      playlistId,
      serviceId,
      first.result.deletedVideosWithoutMatch,
      first.result.processedIds,
    );
    expect(resolved.pendingMatches).toHaveLength(1);
    const offered = resolved.pendingMatches[0]!;
    expect(offered.candidateTracks.map((c) => c.id)).toContain(candidate.id);

    const confirmed = await confirmOrphanedMatches(
      playlistId,
      [
        {
          deletedItemId: offered.deletedVideo.itemId,
          selectedTrackId: candidate.id,
          position: offered.deletedVideo.position,
          action: "match",
        },
      ],
      playlist.ownerId,
    );
    expect(confirmed.success).toBe(true);
    const stamped = await prisma.servicePlaylistTrack.findFirstOrThrow({
      where: { playlistId, trackId: candidate.id },
    });
    expect(stamped.playlistItemId).toBe("pi-9");

    const second = await sync(payload);
    expect(second.result.deletedVideosWithoutMatch ?? []).toHaveLength(0);
    const again = await resolveDeletedVideosAfterSync(
      playlistId,
      serviceId,
      second.result.deletedVideosWithoutMatch,
      second.result.processedIds,
    );
    expect(again.pendingMatches).toHaveLength(0);
  });
});
