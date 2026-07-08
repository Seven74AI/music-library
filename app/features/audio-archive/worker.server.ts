import { prisma } from '#app/utils/db.server.ts'
import { executeYtDlp, ErrorCategory } from './yt-dlp.server'
import { uploadToTigris, buildObjectKey } from './tigris-upload.server'
import { isWorkerActive } from './worker-control.server'
import { notifyCookieExpired, notifyJobFailed } from './notification.server'
import { cookieFilePath } from './youtube-cookie.server'
import type { ErrorCategory as ErrorCategoryType } from './yt-dlp.server'

/**
 * Maximum number of retry attempts for retriable errors.
 */
const MAX_RETRIES = 3

/**
 * Error categories that should NOT be retried.
 * These are permanent failures (auth, geo, video removed, cookies).
 */
const NON_RETRIABLE_ERRORS: ErrorCategoryType[] = [
	ErrorCategory.AUTH,
	ErrorCategory.GEO_BLOCKED,
	ErrorCategory.VIDEO_UNAVAILABLE,
	ErrorCategory.COOKIE_EXPIRED,
]

/**
 * Process a single tick of the archive queue.
 *
 * 1. Checks if the worker is active (not paused, not on break)
 * 2. Checks if AUDIO_ARCHIVE_ENABLED is true
 * 3. Picks pending jobs ordered by priority then creation date
 * 4. Respects max concurrent limit
 * 5. Downloads audio via yt-dlp, uploads to Tigris
 * 6. Creates TrackAudioFile record on success
 * 7. Updates ArchiveJob status and error history on failure
 */
export async function processQueueTick(): Promise<void> {
	if (process.env.AUDIO_ARCHIVE_ENABLED !== 'true') return

	const active = await isWorkerActive()
	if (!active) return

	const maxConcurrent = Number.parseInt(
		process.env.AUDIO_ARCHIVE_MAX_CONCURRENT ?? '2',
		10,
	)

	// Check how many jobs are currently processing
	const processingCount = await prisma.archiveJob.count({
		where: { status: 'processing' },
	})

	const available = maxConcurrent - processingCount
	if (available <= 0) return

	// Pick pending jobs: priority first, then oldest first
	const jobs = await prisma.archiveJob.findMany({
		where: { status: 'pending' },
		orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
		take: available,
		include: {
			track: {
				select: {
					id: true,
					serviceUrl: true,
				},
			},
		},
	})

	if (jobs.length === 0) return

	const cookieFile = cookieFilePath()

	for (const job of jobs) {
		await processJob(job.id, job.track.id, job.track.serviceUrl ?? '', cookieFile)
	}

	// Update last queue run timestamp
	await prisma.workerState.upsert({
		where: { id: 'singleton' },
		update: { lastQueueRun: new Date() },
		create: { id: 'singleton', status: 'running' },
	})
}

/**
 * Process a single archive job.
 */
async function processJob(
	jobId: string,
	trackId: string,
	url: string,
	cookieFile?: string,
): Promise<void> {
	// Mark as processing
	await prisma.archiveJob.update({
		where: { id: jobId },
		data: {
			status: 'processing',
			lastAttemptAt: new Date(),
		},
	})

	// Update WorkerState to show currently processing
	await prisma.workerState.upsert({
		where: { id: 'singleton' },
		update: { currentlyProcessing: jobId },
		create: { id: 'singleton', status: 'running', currentlyProcessing: jobId },
	})

	try {
		// 1. Download via yt-dlp
		const result = await executeYtDlp(url, { cookieFile })

		if (result.exitCode !== 0 || !result.filePath) {
			await handleJobError(jobId, result.errorCategory ?? 'UNKNOWN', result.errorMessage ?? null, url)
			return
		}

		// 2. Upload to Tigris
		const key = buildObjectKey(trackId, result.filePath)

		const uploadResult = await uploadToTigris(result.filePath, key)

		// 3. Create TrackAudioFile record
		await prisma.trackAudioFile.create({
			data: {
				trackId,
				objectKey: uploadResult.key,
				fileName: uploadResult.key.split('/').pop(),
				format: 'mp3',
				mimeType: 'audio/mpeg',
			},
		})

		// 4. Mark job as completed
		await prisma.archiveJob.update({
			where: { id: jobId },
			data: { status: 'completed' },
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		await handleJobError(jobId, 'UNKNOWN', message, url)
	} finally {
		// Clear currently processing
		await prisma.workerState.upsert({
			where: { id: 'singleton' },
			update: { currentlyProcessing: null },
			create: { id: 'singleton', status: 'running' },
		})
	}
}

/**
 * Handle a job error: categorize, record in error history, and
 * either mark as failed (non-retriable) or reset to pending for retry.
 *
 * Side effects:
 * - Invalidates YoutubeCookie records on AUTH/COOKIE_EXPIRED errors
 * - Sends Telegram notification for permanent failures
 */
async function handleJobError(
	jobId: string,
	category: ErrorCategoryType,
	message: string | null,
	trackUrl: string,
): Promise<void> {
	const job = await prisma.archiveJob.findUnique({
		where: { id: jobId },
		select: { retryCount: true, errorHistory: true },
	})

	if (!job) return

	const errorEntry = {
		category,
		message: message ?? 'Unknown error',
		timestamp: new Date().toISOString(),
	}

	let errorHistory: unknown[]
	try {
		errorHistory = JSON.parse(job.errorHistory) as unknown[]
	} catch {
		errorHistory = []
	}
	errorHistory.push(errorEntry)

	const newRetryCount = job.retryCount + 1
	const isNonRetriable = NON_RETRIABLE_ERRORS.includes(category)
	const shouldFail = isNonRetriable || newRetryCount >= MAX_RETRIES

	await prisma.archiveJob.update({
		where: { id: jobId },
		data: {
			status: shouldFail ? 'failed' : 'pending',
			retryCount: newRetryCount,
			errorHistory: JSON.stringify(errorHistory),
		},
	})

	// Cookie-related errors: flag all cookies as invalid + notify admin
	if (category === ErrorCategory.AUTH || category === ErrorCategory.COOKIE_EXPIRED) {
		await prisma.youtubeCookie.updateMany({
			where: { valid: true },
			data: { valid: false, updatedAt: new Date() },
		})

		void notifyCookieExpired(jobId, trackUrl, message ?? 'Unknown error')
	}

	// Notify on other permanent failures (fire-and-forget)
	if (shouldFail && category !== ErrorCategory.AUTH && category !== ErrorCategory.COOKIE_EXPIRED) {
		void notifyJobFailed(jobId, trackUrl, category, message ?? 'Unknown error')
	}
}

/**
 * Get the current queue stats for monitoring.
 */
export async function getQueueStats(): Promise<{
	pending: number
	processing: number
	completed: number
	failed: number
}> {
	const [pending, processing, completed, failed] = await Promise.all([
		prisma.archiveJob.count({ where: { status: 'pending' } }),
		prisma.archiveJob.count({ where: { status: 'processing' } }),
		prisma.archiveJob.count({ where: { status: 'completed' } }),
		prisma.archiveJob.count({ where: { status: 'failed' } }),
	])

	return { pending, processing, completed, failed }
}
