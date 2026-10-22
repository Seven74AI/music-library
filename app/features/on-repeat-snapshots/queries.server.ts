import { prisma } from "#app/utils/db.server.ts";
import { ON_REPEAT_SHELF_SIZE } from "./month.ts";

const SNAPSHOT_TRACK_SELECT = {
  id: true,
  position: true,
  listenCount: true,
  track: {
    select: {
      id: true,
      title: true,
      duration: true,
      serviceUrl: true,
      createdAt: true,
      artist: {
        select: { id: true, name: true },
      },
      coverImage: {
        select: { objectKey: true },
      },
      service: {
        select: { displayName: true, logoUrl: true },
      },
      audioFiles: {
        select: { id: true, format: true, objectKey: true },
      },
    },
  },
} as const;

export type OnRepeatSnapshotSummary = {
  id: string;
  yearMonth: string;
  generatedAt: Date;
  trackCount: number;
  /** First few tracks for cover preview. */
  previewTracks: Array<{
    id: string;
    title: string;
    artist: { id: string; name: string };
    coverImage: { objectKey: string } | null;
    duration: number | null;
  }>;
};

export type OnRepeatSnapshotDetail = {
  id: string;
  yearMonth: string;
  generatedAt: Date;
  tracks: Array<{
    id: string;
    position: number;
    listenCount: number;
    track: {
      id: string;
      title: string;
      duration: number | null;
      serviceUrl: string | null;
      createdAt: Date;
      artist: { id: string; name: string };
      coverImage: { objectKey: string } | null;
      service: { displayName: string; logoUrl: string | null } | null;
      audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
    };
  }>;
};

export async function listOnRepeatSnapshotShelf(
  userId: string,
  limit = ON_REPEAT_SHELF_SIZE,
): Promise<OnRepeatSnapshotSummary[]> {
  const snapshots = await prisma.onRepeatSnapshot.findMany({
    where: { userId },
    orderBy: { yearMonth: "desc" },
    take: limit,
    select: {
      id: true,
      yearMonth: true,
      generatedAt: true,
      _count: { select: { tracks: true } },
      tracks: {
        orderBy: { position: "asc" },
        take: 4,
        select: {
          track: {
            select: {
              id: true,
              title: true,
              duration: true,
              artist: { select: { id: true, name: true } },
              coverImage: { select: { objectKey: true } },
            },
          },
        },
      },
    },
  });

  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    yearMonth: snapshot.yearMonth,
    generatedAt: snapshot.generatedAt,
    trackCount: snapshot._count.tracks,
    previewTracks: snapshot.tracks.map((row) => row.track),
  }));
}

export const ON_REPEAT_HISTORY_PAGE_SIZE = 24;

export async function listOnRepeatSnapshotHistory({
  userId,
  cursor,
  limit = ON_REPEAT_HISTORY_PAGE_SIZE,
}: {
  userId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: OnRepeatSnapshotSummary[]; nextCursor: string | null }> {
  const snapshots = await prisma.onRepeatSnapshot.findMany({
    where: {
      userId,
      ...(cursor ? { yearMonth: { lt: cursor } } : {}),
    },
    orderBy: { yearMonth: "desc" },
    take: limit + 1,
    select: {
      id: true,
      yearMonth: true,
      generatedAt: true,
      _count: { select: { tracks: true } },
      tracks: {
        orderBy: { position: "asc" },
        take: 4,
        select: {
          track: {
            select: {
              id: true,
              title: true,
              duration: true,
              artist: { select: { id: true, name: true } },
              coverImage: { select: { objectKey: true } },
            },
          },
        },
      },
    },
  });

  const hasMore = snapshots.length > limit;
  const page = hasMore ? snapshots.slice(0, limit) : snapshots;
  const last = page[page.length - 1];

  return {
    items: page.map((snapshot) => ({
      id: snapshot.id,
      yearMonth: snapshot.yearMonth,
      generatedAt: snapshot.generatedAt,
      trackCount: snapshot._count.tracks,
      previewTracks: snapshot.tracks.map((row) => row.track),
    })),
    nextCursor: hasMore && last ? last.yearMonth : null,
  };
}

export async function getOnRepeatSnapshotDetail({
  userId,
  snapshotId,
}: {
  userId: string;
  snapshotId: string;
}): Promise<OnRepeatSnapshotDetail | null> {
  const snapshot = await prisma.onRepeatSnapshot.findFirst({
    where: { id: snapshotId, userId },
    select: {
      id: true,
      yearMonth: true,
      generatedAt: true,
      tracks: {
        orderBy: { position: "asc" },
        select: SNAPSHOT_TRACK_SELECT,
      },
    },
  });

  if (!snapshot) return null;

  return {
    id: snapshot.id,
    yearMonth: snapshot.yearMonth,
    generatedAt: snapshot.generatedAt,
    tracks: snapshot.tracks,
  };
}
