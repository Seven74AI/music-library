import { prisma } from "#app/utils/db.server.ts";
import { QUEUE_STATUS_MINE, type ReviewQueueListItem } from "./review-queue.ts";

const PAGE_SIZE = 20;
const CLAIM_TIMEOUT_MS = 2 * 60 * 60 * 1000; // ADR-035: auto-unclaim after 2h inactivity

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Idempotently create a review queue item, per ADR-035.
 *
 * - If an open item already exists for the same (entityType, entityId, issueType,
 *   source), return it without creating a duplicate.
 * - For user reports, increment the existing item's reportCount instead.
 * - The `source` field is part of the dedup key so a system-detected issue and a
 *   user report about the same track can coexist (matches the quality-check job's
 *   multi-item-per-track behavior and the partial unique index in migration
 *   20261022120000_add_review_queue_report_dedup).
 */
export async function createOrUpdateQueueItem(data: {
  entityType: string;
  entityId: string;
  source: string;
  issueType: string;
  description?: string | null;
  reporterId?: string | null;
  priority: number;
}): Promise<{ id: string; created: boolean }> {
  const where = {
    entityType: data.entityType,
    entityId: data.entityId,
    issueType: data.issueType,
    source: data.source,
    status: "open",
  };

  const existing = await prisma.reviewQueueItem.findFirst({
    where,
    select: { id: true },
  });
  if (existing) {
    if (data.source === "user_report") {
      await prisma.reviewQueueItem.update({
        where: { id: existing.id },
        data: { reportCount: { increment: 1 } },
      });
    }
    return { id: existing.id, created: false };
  }

  try {
    const created = await prisma.reviewQueueItem.create({
      data: {
        entityType: data.entityType,
        entityId: data.entityId,
        source: data.source,
        issueType: data.issueType,
        description: data.description ?? null,
        reporterId: data.reporterId ?? null,
        status: "open",
        priority: data.priority,
        reportCount: 1,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    // Concurrent duplicate: another request created the open item between our
    // findFirst and create. Re-read and increment instead of failing.
    if (isUniqueConstraintError(error)) {
      const now = await prisma.reviewQueueItem.findFirst({
        where,
        select: { id: true },
      });
      if (now) {
        if (data.source === "user_report") {
          await prisma.reviewQueueItem.update({
            where: { id: now.id },
            data: { reportCount: { increment: 1 } },
          });
        }
        return { id: now.id, created: false };
      }
    }
    throw error;
  }
}

/**
 * Reset stale `claimed` queue items back to `open` (ADR-035 automatic unclaim).
 * Returns the number of items released.
 */
export async function releaseStaleClaims(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const result = await prisma.reviewQueueItem.updateMany({
    where: { status: "claimed", claimedAt: { lt: cutoff } },
    data: { status: "open", claimedBy: null, claimedAt: null },
  });
  return result.count;
}

export async function listReviewQueue({
  status = "open",
  entityType,
  source,
  page = 1,
  claimedBy,
  reporterId,
}: {
  status?: string;
  entityType?: string;
  source?: string;
  page?: number;
  claimedBy?: string;
  reporterId?: string;
}) {
  const safePage = Math.max(1, page);
  // Reap stale claims before listing so abandoned claims don't block the queue.
  await releaseStaleClaims();
  const mine = status === QUEUE_STATUS_MINE;
  if (mine && !claimedBy) {
    return {
      items: [],
      total: 0,
      page: safePage,
      pageSize: PAGE_SIZE,
      totalPages: 1,
    };
  }
  const where = {
    ...(mine ? { status: "claimed", claimedBy } : status && status !== "all" ? { status } : {}),
    ...(entityType ? { entityType } : {}),
    ...(source ? { source } : {}),
    ...(reporterId ? { reporterId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.reviewQueueItem.findMany({
      where,
      include: {
        reporter: { select: { id: true, username: true, name: true } },
        claimedByUser: { select: { id: true, username: true, name: true } },
        resolvedByUser: { select: { id: true, username: true, name: true } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.reviewQueueItem.count({ where }),
  ]);

  const trackIds = items.filter((item) => item.entityType === "track").map((item) => item.entityId);
  const artistIds = items
    .filter((item) => item.entityType === "artist")
    .map((item) => item.entityId);
  const albumIds = items.filter((item) => item.entityType === "album").map((item) => item.entityId);

  const [tracks, artists, albums] = await Promise.all([
    trackIds.length
      ? prisma.track.findMany({
          where: { id: { in: trackIds } },
          select: { id: true, title: true, artist: { select: { name: true } } },
        })
      : [],
    artistIds.length
      ? prisma.artist.findMany({
          where: { id: { in: artistIds } },
          select: { id: true, name: true },
        })
      : [],
    albumIds.length
      ? prisma.album.findMany({
          where: { id: { in: albumIds } },
          select: { id: true, name: true, artist: { select: { name: true } } },
        })
      : [],
  ]);

  const trackNames = new Map(
    tracks.map((track) => [track.id, `${track.title} — ${track.artist.name}`]),
  );
  const artistNames = new Map(artists.map((artist) => [artist.id, artist.name]));
  const albumNames = new Map(
    albums.map((album) => [album.id, `${album.name} — ${album.artist.name}`]),
  );

  const enriched: ReviewQueueListItem[] = items.map((item) => {
    let name = "Unknown";
    if (item.entityType === "track") name = trackNames.get(item.entityId) ?? "Unknown track";
    if (item.entityType === "artist") name = artistNames.get(item.entityId) ?? "Unknown artist";
    if (item.entityType === "album") name = albumNames.get(item.entityId) ?? "Unknown album";
    return {
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      source: item.source,
      issueType: item.issueType,
      description: item.description,
      status: item.status,
      priority: item.priority,
      claimedBy: item.claimedBy,
      resolution: item.resolution,
      resolutionComment: item.resolutionComment,
      createdAt: item.createdAt.toISOString(),
      entityDetails: { name },
      reporter: item.reporter,
      claimedByUser: item.claimedByUser,
      resolvedByUser: item.resolvedByUser,
    };
  });

  return {
    items: enriched,
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
