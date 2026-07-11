import { readFileSync } from 'node:fs'
import { getOrCreateArtist } from '#app/utils/artist-management.server'
import { extractAudioMetadata } from '#app/utils/audio-metadata.server'
import { getOrCreateAlbum } from '#app/utils/cover-management.server'
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
import { uploadToTigris, buildObjectKey } from './tigris-upload.server'
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
		update: { currentlyProcessing: null },
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
					},
				},
			},
		})

		if (jobs.length === 0) break

		await Promise.all(
			jobs.map((job) =>
				processJob(job.id, job.track.id, job.track.serviceUrl ?? '', cookieFile),
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
		const audioBuffer = readFileSync(result.filePath)
		const extractedMetadata = await extractAudioMetadata(audioBuffer, result.filePath)

		const uploadResult = await uploadToTigris(result.filePath, key)

		// 3. Create TrackAudioFile record
		await prisma.trackAudioFile.create({
			data: {
				trackId,
				objectKey: uploadResult.key,
				fileName: uploadResult.key.split('/').pop(),
				format: extractedMetadata.format || 'mp3',
				mimeType: extractedMetadata.mimeType || 'audio/mpeg',
				fileSize: audioBuffer.length,
				bitrate: extractedMetadata.bitrate,
				sampleRate: extractedMetadata.sampleRate,
			},
		})

		// Metadata backfill is best-effort: the audio file is already uploaded and
		// TrackAudioFile created, so failing the job here would cause a retry that
		// re-downloads and creates a duplicate TrackAudioFile.
		try {
			await updateTrackMetadataFromAudioFile(trackId, extractedMetadata)
		} catch (error) {
			console.error(
				`Failed to update track metadata from audio file for track ${trackId}:`,
				error,
			)
		}

		// 4. Mark job as completed
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
		// Clear currently processing
		await prisma.workerState.upsert({
			where: { id: 'singleton' },
			update: { currentlyProcessing: null },
			create: { id: 'singleton', status: 'running' },
		})
	}
}

function parseOptionalDate(value?: string): Date | undefined {
	if (!value) return undefined
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date
}

async function updateTrackMetadataFromAudioFile(
	trackId: string,
	metadata: Awaited<ReturnType<typeof extractAudioMetadata>>,
): Promise<void> {
	const trackUpdateData: Record<string, unknown> = {}
	const existingTrack = await prisma.track.findUnique({
		where: { id: trackId },
		select: { artistId: true },
	})

	if (metadata.title) trackUpdateData.title = metadata.title
	if (metadata.duration !== undefined) trackUpdateData.duration = metadata.duration
	if (metadata.albumArtist) trackUpdateData.albumArtist = metadata.albumArtist
	if (metadata.bpm !== undefined) trackUpdateData.bpm = metadata.bpm
	if (metadata.label) trackUpdateData.label = metadata.label
	if (metadata.isrc) trackUpdateData.isrc = metadata.isrc
	if (metadata.originalYear !== undefined) trackUpdateData.originalYear = metadata.originalYear
	if (metadata.totalTracks !== undefined) trackUpdateData.totalTracks = metadata.totalTracks
	if (metadata.totalDiscs !== undefined) trackUpdateData.totalDiscs = metadata.totalDiscs
	if (metadata.lyrics) trackUpdateData.lyrics = metadata.lyrics
	if (metadata.track?.no !== undefined) trackUpdateData.trackNumber = metadata.track.no
	if (metadata.genre && metadata.genre.length > 0) {
		trackUpdateData.genre = metadata.genre[0]
	}

	const releaseDate = parseOptionalDate(metadata.releaseDate)
	if (releaseDate) trackUpdateData.releaseDate = releaseDate

	const originalDate = parseOptionalDate(metadata.originalDate)
	if (originalDate) trackUpdateData.originalDate = originalDate

	let artistId = existingTrack?.artistId
	if (metadata.artist) {
		const artist = await getOrCreateArtist(metadata.artist)
		artistId = artist.id
		trackUpdateData.artistId = artist.id
	}

	if (metadata.album && artistId) {
		const album = await getOrCreateAlbum(artistId, metadata.album, metadata.year)
		if (album) {
			trackUpdateData.albumId = album.id
		}
	}

	if (metadata.year !== undefined) trackUpdateData.year = metadata.year

	if (Object.keys(trackUpdateData).length === 0) return

	await prisma.track.update({
		where: { id: trackId },
		data: trackUpdateData,
	})
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
	const [pending, processing, completed, failed] = await Promise.all([
		prisma.archiveJob.count({ where: { status: 'pending' } }),
		prisma.archiveJob.count({ where: { status: 'processing' } }),
		prisma.archiveJob.count({ where: { status: 'completed' } }),
		prisma.archiveJob.count({ where: { status: 'failed' } }),
	])

	return { pending, processing, completed, failed }
}
