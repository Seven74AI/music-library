import { readFileSync } from 'node:fs'
import path from 'node:path'
import { persistTrackAudio } from '#app/features/track-audio-ingest/persist-track-audio.server.ts'
import { extractAudioMetadata } from '#app/utils/audio-metadata.server'
import { prisma } from '#app/utils/db.server.ts'
import { checkPlaylistArchiveReadyAfterTrackArchived } from '#app/utils/playlist-archive-ready.server.tsx'
import {
	recordArchiveSuccess,
	recordCookieExpiredFailure,
	resetCookieFailureStreak,
	isCookieExpiredFailure,
	COOKIE_FAILURE_PAUSE_THRESHOLD,
} from './cookie-failure-streak.ts'
import { notifyCookieExpired, notifyJobFailed, notifyWorkerPausedForCookies } from './notification.server'
import { isWorkerActive, pauseWorker } from './worker-control.server'
import { getCookieFilePath } from './youtube-cookie.server'
import { executeYtDlp, ErrorCategory, type ErrorCategory as ErrorCategoryType  } from './yt-dlp.server'

/**
 * Maximum number of retry attempts for retriable errors.
 */
const MAX_RETRIES = 3

/** Default stale threshold: 2× yt-dlp timeout (5 min each). */
const DEFAULT_STALE_JOB_MS = 600_000

let queueTickInFlight = false

const ENQUEUE_WAKE_DEBOUNCE_MS = 500
let enqueueWakeTimer: ReturnType<typeof setTimeout> | null = null

/** In-memory set of job IDs currently being processed. Avoids DB writes per job. */
const currentlyProcessingSet = new Set<string>()

/** Exported for admin UI — returns all job IDs currently being processed. */
export function getCurrentlyProcessingJobs(): string[] {
	return [...currentlyProcessingSet]
}

/**
 * Wake the archive worker soon after new jobs are enqueued.
 * Debounced so bulk imports schedule one tick instead of one per track.
 */
export function scheduleQueueTick(): void {
	if (process.env.AUDIO_ARCHIVE_ENABLED !== 'true') return
	if (enqueueWakeTimer) clearTimeout(enqueueWakeTimer)
	enqueueWakeTimer = setTimeout(() => {
		enqueueWakeTimer = null
		void processQueueTick()
	}, ENQUEUE_WAKE_DEBOUNCE_MS)
}

function getStaleJobThresholdMs(): number {
	const parsed = Number.parseInt(
		process.env.AUDIO_ARCHIVE_STALE_JOB_MS ?? String(DEFAULT_STALE_JOB_MS),
		10,
	)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_JOB_MS
}

/**
 * Reset archive jobs left in `processing` after a crash, deploy, or hung step.
 * Without this, orphaned jobs fill all concurrency slots and the queue stalls.
 */
export async function recoverStaleProcessingJobs(): Promise<number> {
	const cutoff = new Date(Date.now() - getStaleJobThresholdMs())

	const staleJobs = await prisma.archiveJob.findMany({
		where: {
			status: 'processing',
			OR: [
				{ lastAttemptAt: { lt: cutoff } },
				{ lastAttemptAt: null, updatedAt: { lt: cutoff } },
			],
		},
		select: { id: true },
	})

	if (staleJobs.length === 0) return 0

	for (const job of staleJobs) {
		await handleJobError(
			job.id,
			ErrorCategory.UNKNOWN,
			'Processing timed out (worker recovered stale job)',
			'',
		)
	}

	await prisma.workerState.upsert({
		where: { id: 'singleton' },
		update: {},
		create: { id: 'singleton', status: 'running' },
	})

	console.warn(`Recovered ${staleJobs.length} stale archive job(s)`)
	return staleJobs.length
}

/**
 * Error categories that should NOT be retried.
 * These are permanent failures (auth, geo, video removed, cookies).
 */
const NON_RETRIABLE_ERRORS: ErrorCategoryType[] = [
	ErrorCategory.AUTH,
	ErrorCategory.GEO_BLOCKED,
	ErrorCategory.VIDEO_UNAVAILABLE,
	ErrorCategory.COOKIE_EXPIRED,
	ErrorCategory.FILE_NOT_FOUND,
]

function categorizeJobError(error: unknown): ErrorCategoryType {
	if (error && typeof error === 'object' && 'code' in error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === 'ENOENT') return ErrorCategory.FILE_NOT_FOUND
	}
	return ErrorCategory.UNKNOWN
}

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
	if (queueTickInFlight) return

	queueTickInFlight = true
	try {
		await processQueueTickInner()
	} finally {
		queueTickInFlight = false
	}
}

async function processQueueTickInner(): Promise<void> {
	const active = await isWorkerActive()
	if (!active) return

	const maxConcurrent = Number.parseInt(
		process.env.AUDIO_ARCHIVE_MAX_CONCURRENT ?? '2',
		10,
	)

	const cookieFile = getCookieFilePath()

	while (true) {
		const stillActive = await isWorkerActive()
		if (!stillActive) break

		await recoverStaleProcessingJobs()

		const processingCount = await prisma.archiveJob.count({
			where: { status: 'processing' },
		})

		const available = maxConcurrent - processingCount
		if (available <= 0) break

		const jobs = await prisma.archiveJob.findMany({
			where: { status: 'pending' },
			orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
			take: available,
			include: {
				track: {
					select: {
						id: true,
						serviceUrl: true,
						service: { select: { name: true } },
					},
				},
			},
		})

		if (jobs.length === 0) break

		await Promise.all(
			jobs.map((job) =>
				processJob(
					job.id,
					job.track.id,
					job.track.service.name,
					job.track.serviceUrl ?? '',
					cookieFile,
				),
			),
		)
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
	serviceName: string,
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

	// Track in memory — avoids extra DB write per job
	currentlyProcessingSet.add(jobId)

	try {
		// 1. Download via yt-dlp
		const result = await executeYtDlp(url, { cookieFile })

		if (result.exitCode !== 0 || !result.filePath) {
			await handleJobError(jobId, result.errorCategory ?? 'UNKNOWN', result.errorMessage ?? null, url)
			return
		}

		// 2. Persist audio: upload → TrackAudioFile → best-effort metadata backfill
		const audioBuffer = readFileSync(result.filePath)
		const extractedMetadata = await extractAudioMetadata(audioBuffer, result.filePath)
		const extension =
			path.extname(result.filePath).slice(1) ||
			extractedMetadata.format ||
			'mp3'

		await persistTrackAudio({
			trackId,
			serviceName,
			buffer: audioBuffer,
			metadata: extractedMetadata,
			extension,
		})

		// 3. Mark job as completed
		await prisma.archiveJob.update({
			where: { id: jobId },
			data: { status: 'completed' },
		})

		recordArchiveSuccess()

		void checkPlaylistArchiveReadyAfterTrackArchived(
			trackId,
			process.env.SITE_URL,
		).catch((error) => {
			console.error(
				`Failed to check playlist archive readiness for track ${trackId}:`,
				error,
			)
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		await handleJobError(jobId, categorizeJobError(error), message, url)
	} finally {
		currentlyProcessingSet.delete(jobId)
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

		if (isCookieExpiredFailure(category)) {
			const shouldPause = recordCookieExpiredFailure()
			if (shouldPause) {
				await pauseWorker()
				void notifyWorkerPausedForCookies(COOKIE_FAILURE_PAUSE_THRESHOLD)
			}
		}
	}

	// Notify on other permanent failures (fire-and-forget)
	if (shouldFail && category !== ErrorCategory.AUTH && category !== ErrorCategory.COOKIE_EXPIRED) {
		void notifyJobFailed(jobId, trackUrl, category, message ?? 'Unknown error')
	}
}

export { resetCookieFailureStreak } from './cookie-failure-streak.ts'

/**
 * Get the current queue stats for monitoring.
 */
export async function getQueueStats(): Promise<{
	pending: number
	processing: number
	completed: number
	failed: number
}> {
	const groups = await prisma.archiveJob.groupBy({
		by: ['status'],
		_count: { _all: true },
	})

	const byStatus = Object.fromEntries(
		groups.map((g) => [g.status, g._count._all]),
	)

	return {
		pending: byStatus['pending'] ?? 0,
		processing: byStatus['processing'] ?? 0,
		completed: byStatus['completed'] ?? 0,
		failed: byStatus['failed'] ?? 0,
	}
}
