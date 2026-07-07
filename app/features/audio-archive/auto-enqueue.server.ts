/**
 * Auto-enqueue for audio archiving.
 *
 * Called from track-batch-processor during YouTube playlist sync.
 * Creates a pending ArchiveJob for tracks that have a serviceUrl
 * (external service tracks, not local uploads).
 *
 * Only enqueues when AUDIO_ARCHIVE_ENABLED is true.
 */

/**
 * Ensure an ArchiveJob exists for a track after import/sync.
 *
 * - Creates a new pending ArchiveJob if none exists for this track
 * - Silently skips if a job already exists (unique constraint on trackId)
 *   — this handles re-syncs gracefully
 *
 * @param tx - Prisma transaction client
 * @param trackId - Track ID to enqueue for archiving
 */
export async function enqueueArchiveJob(
	tx: any,
	trackId: string,
): Promise<void> {
	if (process.env.AUDIO_ARCHIVE_ENABLED !== 'true') return

	try {
		await tx.archiveJob.create({
			data: {
				trackId,
				status: 'pending',
				priority: false, // auto-enqueued, not user-requested
			},
		})
	} catch {
		// Unique constraint violation — job already exists for this track.
		// Silently skip: the existing job (pending/processing/completed/failed)
		// should not be disrupted by a re-import.
	}
}
