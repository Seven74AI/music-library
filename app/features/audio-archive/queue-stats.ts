/**
 * Success rate for archive jobs that have finished (completed or failed).
 * Pending and in-flight processing jobs are excluded — they have no outcome yet.
 */
export function computeArchiveQueueSuccessRate(
	completed: number,
	failed: number,
): number {
	const finished = completed + failed
	return finished > 0 ? Math.round((completed / finished) * 100) : 0
}
