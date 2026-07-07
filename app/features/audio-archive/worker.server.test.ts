import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock prisma
const mockPrisma = {
	archiveJob: {
		count: vi.fn(),
		findMany: vi.fn(),
		findUnique: vi.fn(),
		update: vi.fn(),
	},
	workerState: {
		upsert: vi.fn(),
	},
	trackAudioFile: {
		create: vi.fn(),
	},
	$disconnect: vi.fn().mockResolvedValue(undefined),
}

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: mockPrisma,
}))

// Mock yt-dlp service
const mockExecuteYtDlp = vi.fn()
vi.mock('./yt-dlp.server', () => ({
	executeYtDlp: mockExecuteYtDlp,
	ErrorCategory: {
		AUTH: 'AUTH',
		RATE_LIMITED: 'RATE_LIMITED',
		GEO_BLOCKED: 'GEO_BLOCKED',
		VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE',
		NETWORK: 'NETWORK',
		COOKIE_EXPIRED: 'COOKIE_EXPIRED',
		UNKNOWN: 'UNKNOWN',
	},
}))

// Mock tigris upload
const mockUploadToTigris = vi.fn()
const mockBuildObjectKey = vi.fn()
vi.mock('./tigris-upload.server', () => ({
	uploadToTigris: mockUploadToTigris,
	buildObjectKey: mockBuildObjectKey,
}))

// Mock worker control
const mockIsWorkerActive = vi.fn()
vi.mock('./worker-control.server', () => ({
	isWorkerActive: mockIsWorkerActive,
}))

describe('processQueueTick', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		vi.clearAllMocks()
		process.env.AUDIO_ARCHIVE_ENABLED = 'true'
		// Default: worker is active
		mockIsWorkerActive.mockResolvedValue(true)
		// Default: no processing jobs
		mockPrisma.archiveJob.count.mockResolvedValue(0)
		// Default: no pending jobs
		mockPrisma.archiveJob.findMany.mockResolvedValue([])
		// Mock upsert to be a no-op
		mockPrisma.workerState.upsert.mockResolvedValue({})

		mockBuildObjectKey.mockImplementation(
			(trackId: string, filePath: string) => `audio/${trackId}/${filePath.split('/').pop()}`,
		)
		mockUploadToTigris.mockResolvedValue({
			key: 'audio/track-1/test.mp3',
			bucket: 'mock-bucket',
			location: 'https://mock-bucket.fly.storage.tigris.dev/audio/track-1/test.mp3',
		})
		mockExecuteYtDlp.mockResolvedValue({
			exitCode: 0,
			stdout: '[download] Destination: /tmp/test-audio.mp3',
			stderr: '',
			filePath: '/tmp/test-audio.mp3',
			errorCategory: null,
			errorMessage: null,
		})
	})

	describe('AUDIO_ARCHIVE_ENABLED check', () => {
		it('skips processing when AUDIO_ARCHIVE_ENABLED is not true', async () => {
			const originalEnv = process.env.AUDIO_ARCHIVE_ENABLED
			process.env.AUDIO_ARCHIVE_ENABLED = 'false'

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should not query for pending jobs
			expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled()

			process.env.AUDIO_ARCHIVE_ENABLED = originalEnv
		})
	})

	describe('worker active check', () => {
		it('skips processing when worker is not active', async () => {
			mockIsWorkerActive.mockResolvedValue(false)

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled()
		})
	})

	describe('max concurrent limit', () => {
		it('skips when all slots are full', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(2) // 2 processing
			process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = '2'

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled()
		})

		it('picks only available slots', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(1) // 1 processing
			process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = '3'
			mockPrisma.archiveJob.findMany.mockResolvedValue([])

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should request at most 2 jobs (3 max - 1 processing)
			expect(mockPrisma.archiveJob.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 2 }),
			)
		})
	})

	describe('empty queue', () => {
		it('does nothing when no pending jobs', async () => {
			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.archiveJob.findMany).toHaveBeenCalled()
			expect(mockExecuteYtDlp).not.toHaveBeenCalled()
		})
	})

	describe('successful job processing', () => {
		it('processes pending jobs: download → upload → complete', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-1',
					status: 'pending',
					priority: true,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-1', serviceUrl: 'https://youtube.com/watch?v=abc123' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ trackId: 'track-1' })

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should have yt-dlp called with the URL
			expect(mockExecuteYtDlp).toHaveBeenCalledWith(
				'https://youtube.com/watch?v=abc123',
				expect.objectContaining({ cookieFile: '/data/youtube-cookies.txt' }),
			)

			// Should upload to tigris
			expect(mockUploadToTigris).toHaveBeenCalled()

			// Should create TrackAudioFile record
			expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						trackId: 'track-1',
						format: 'mp3',
						mimeType: 'audio/mpeg',
					}),
				}),
			)

			// Should mark job as completed
			expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: 'job-1' },
					data: { status: 'completed' },
				}),
			)
		})
	})

	describe('error handling', () => {
		it('handles yt-dlp failure: marks as failed for non-retriable errors', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-2',
					status: 'pending',
					priority: false,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-2', serviceUrl: 'https://youtube.com/watch?v=xyz' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 1,
				stdout: '',
				stderr: 'ERROR: Video unavailable',
				filePath: undefined,
				errorCategory: 'VIDEO_UNAVAILABLE',
				errorMessage: 'Video unavailable',
			})

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should mark as failed (non-retriable)
			expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: 'job-2' },
					data: expect.objectContaining({
						status: 'failed',
						retryCount: 1,
						errorHistory: expect.stringContaining('VIDEO_UNAVAILABLE'),
					}),
				}),
			)

			// Should NOT upload or create TrackAudioFile
			expect(mockUploadToTigris).not.toHaveBeenCalled()
			expect(mockPrisma.trackAudioFile.create).not.toHaveBeenCalled()
		})

		it('resets to pending for retriable errors (under max retries)', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-3',
					status: 'pending',
					priority: false,
					retryCount: 1,
					errorHistory: '[]',
					track: { id: 'track-3', serviceUrl: 'https://youtube.com/watch?v=net' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 1, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 1,
				stdout: '',
				stderr: 'ERROR: ETIMEDOUT',
				filePath: undefined,
				errorCategory: 'NETWORK',
				errorMessage: 'Connection timed out',
			})

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should reset to pending (retriable, under max retries)
			expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						status: 'pending',
						retryCount: 2,
					}),
				}),
			)
		})

		it('marks as failed when max retries exceeded', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-4',
					status: 'pending',
					priority: false,
					retryCount: 3, // Already at max
					errorHistory: '[]',
					track: { id: 'track-4', serviceUrl: 'https://youtube.com/watch?v=max' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 3, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 1,
				stdout: '',
				stderr: 'ERROR: ETIMEDOUT',
				filePath: undefined,
				errorCategory: 'NETWORK',
				errorMessage: 'Timed out',
			})

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						status: 'failed',
						retryCount: 4,
					}),
				}),
			)
		})
	})
})

describe('getQueueStats', () => {
	it('returns counts for all statuses', async () => {
		mockPrisma.archiveJob.count
			.mockResolvedValueOnce(3) // pending
			.mockResolvedValueOnce(1) // processing
			.mockResolvedValueOnce(10) // completed
			.mockResolvedValueOnce(2) // failed

		const { getQueueStats } = await import('./worker.server.ts')
		const stats = await getQueueStats()

		expect(stats).toEqual({
			pending: 3,
			processing: 1,
			completed: 10,
			failed: 2,
		})
	})
})
