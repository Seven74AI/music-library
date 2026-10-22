import { prisma } from "#app/utils/db.server.ts";
import {
  HEAVY_ROTATION_HOME_CAP,
  type HeavyRotationTrack,
  type HeavyRotationWindow,
  sortByPlayCompletedCount,
} from "./heavy-rotation.ts";
import { getPlayCompletedCountsByTrack } from "./play-completed-counts.server.ts";

const HEAVY_ROTATION_TRACK_SELECT = {
  id: true,
  title: true,
  duration: true,
  serviceUrl: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
  coverImage: {
    select: {
      objectKey: true,
    },
  },
  service: {
    select: {
      name: true,
      displayName: true,
      logoUrl: true,
    },
  },
  audioFiles: {
    select: {
      id: true,
      format: true,
      objectKey: true,
    },
  },
} as const;

export type { HeavyRotationTrack };

/**
 * Ranked Heavy Rotation tiles for the listening hub.
 * Cap defaults to {@link HEAVY_ROTATION_HOME_CAP}; empty → caller hides the strip.
 */
export async function getHeavyRotationTracks({
  userId,
  window,
  now = new Date(),
  limit = HEAVY_ROTATION_HOME_CAP,
}: {
  userId: string;
  window: HeavyRotationWindow;
  now?: Date;
  limit?: number;
}): Promise<HeavyRotationTrack[]> {
  const counts = await getPlayCompletedCountsByTrack({ userId, window, now });
  if (counts.size === 0) return [];

  const ranked = sortByPlayCompletedCount(
    [...counts.entries()].map(([trackId, completedCount]) => ({
      id: trackId,
      trackId,
      createdAt: new Date(0),
      completedCount,
    })),
    counts,
  );

  // Prefer higher counts; among equal counts the stub createdAt is identical so
  // id asc (from compare) keeps ordering stable.
  const topIds = ranked.slice(0, limit).map((row) => row.trackId);

  const tracks = await prisma.track.findMany({
    where: { id: { in: topIds } },
    select: HEAVY_ROTATION_TRACK_SELECT,
  });
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const result: HeavyRotationTrack[] = [];
  for (const trackId of topIds) {
    const track = trackById.get(trackId);
    if (!track) continue; // dangling UsageEvent trackId
    result.push({
      completedCount: counts.get(trackId) ?? 0,
      track,
    });
  }
  return result;
}
