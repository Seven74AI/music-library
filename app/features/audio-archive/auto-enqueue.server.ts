/**
 * Auto-enqueue for audio archiving.
 *
 * Called from service-playlist batch processor during YouTube playlist sync.
 * Creates a pending ArchiveJob for tracks that have a serviceUrl
 * (external service tracks, not local uploads).
 */

import { chunkArray } from "#app/utils/chunk-array";
import { isUniqueConstraintError } from "#app/utils/prisma-errors.ts";
import { type Prisma } from "#prisma/client.js";
import { scheduleQueueTick } from "./worker.server.ts";

/**
 * Ensure an ArchiveJob exists for a track after import/sync.
 *
 * - Creates a new pending ArchiveJob if none exists for this track
 * - Silently skips if a job already exists (unique constraint on trackId)
 *   — this handles re-syncs gracefully (Decision #18)
 * - Re-throws any other error (transient DB failures must not silently drop
 *   a track from the archive queue — that would leave it permanently
 *   un-archived with zero observability)
 *
 * @param tx - Prisma transaction client
 * @param trackId - Track ID to enqueue for archiving
 */
export async function enqueueArchiveJob(
  tx: Prisma.TransactionClient,
  trackId: string,
): Promise<void> {
  try {
    await tx.archiveJob.create({
      data: {
        trackId,
        status: "pending",
        priority: false, // auto-enqueued, not user-requested
      },
    });
    scheduleQueueTick();
  } catch (error) {
    // Unique constraint violation — job already exists for this track.
    // Silently skip: the existing job (pending/processing/completed/failed)
    // should not be disrupted by a re-import.
    if (!isUniqueConstraintError(error)) {
      console.error(`Failed to enqueue archive job for track ${trackId}:`, error);
      throw error;
    }
  }
}

/**
 * Batch variant of enqueueArchiveJob for playlist sync.
 *
 * Instead of one create() per track (which floods logs with unique
 * constraint errors and issues N queries on re-syncs of large playlists),
 * this does one findMany to detect existing jobs and one createMany for
 * the missing ones.
 *
 * @param tx - Prisma transaction client
 * @param trackIds - Track IDs to enqueue for archiving
 */
export async function enqueueArchiveJobs(
  tx: Prisma.TransactionClient,
  trackIds: string[],
): Promise<void> {
  const uniqueTrackIds = [...new Set(trackIds)];
  if (uniqueTrackIds.length === 0) return;

  const existingTrackIds = new Set<string>();
  // Chunked IN queries to stay under SQLite bind-parameter limit
  for (const idChunk of chunkArray(uniqueTrackIds)) {
    const existing = await tx.archiveJob.findMany({
      where: { trackId: { in: idChunk } },
      select: { trackId: true },
    });
    for (const job of existing) existingTrackIds.add(job.trackId);
  }

  const toCreate = uniqueTrackIds.filter((id) => !existingTrackIds.has(id));
  if (toCreate.length === 0) return;

  try {
    await tx.archiveJob.createMany({
      data: toCreate.map((trackId) => ({
        trackId,
        status: "pending",
        priority: false, // auto-enqueued, not user-requested
      })),
    });
    scheduleQueueTick();
  } catch (error) {
    // A concurrent sync can still race the findMany and hit the unique
    // constraint on createMany. That is the only error we may swallow —
    // everything else (transient DB failure) must propagate so the caller
    // can observe it instead of silently leaving tracks un-archived.
    if (!isUniqueConstraintError(error)) {
      console.error(`Failed to enqueue archive jobs for ${toCreate.length} tracks:`, error);
      throw error;
    }
  }
}
