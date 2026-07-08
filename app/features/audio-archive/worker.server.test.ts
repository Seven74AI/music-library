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
	youtubeCookie: {
		updateMany: vi.fn(),
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
		FILE_NOT_FOUND: 'FILE_NOT_FOUND',
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

// Mock notification service
const mockNotifyCookieExpired = vi.fn().mockResolvedValue(undefined)
const mockNotifyJobFailed = vi.fn().mockResolvedValue(undefined)
vi.mock('./notification.server', () => ({
	notifyCookieExpired: mockNotifyCookieExpired,
	notifyJobFailed: mockNotifyJobFailed,
}))

describe('processQueueTick', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		vi.clearAllMocks()
		process.env.AUDIO_ARCHIVE_ENABLED = 'true'
		mockIsWorkerActive.mockResolvedValue(true)
		mockPrisma.archiveJob.count.mockResolvedValue(0)
		mockPrisma.archiveJob.findMany.mockResolvedValue([])
		mockPrisma.workerState.upsert.mockResolvedValue({})
		mockPrisma.youtubeCookie.updateMany.mockResolvedValue({ count: 1 })

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
			mockPrisma.archiveJob.count.mockResolvedValue(2)
			process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = '2'

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled()
		})

		it('picks only available slots', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(1)
			process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = '3'
			mockPrisma.archiveJob.findMany.mockResolvedValue([])

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

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
			delete process.env.COOKIE_FILE_PATH
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

			expect(mockExecuteYtDlp).toHaveBeenCalledWith(
				'https://youtube.com/watch?v=abc123',
				expect.objectContaining({ cookieFile: '/data/youtube-cookies.txt' }),
			)
			expect(mockUploadToTigris).toHaveBeenCalled()
			expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						trackId: 'track-1',
						format: 'mp3',
						mimeType: 'audio/mpeg',
					}),
				}),
			)
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
			expect(mockUploadToTigris).not.toHaveBeenCalled()
			expect(mockPrisma.trackAudioFile.create).not.toHaveBeenCalled()
		})

		it('marks upload ENOENT as failed immediately without retrying', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-enoent',
					status: 'pending',
					priority: false,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-enoent', serviceUrl: 'https://youtube.com/watch?v=abc' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 0,
				stdout: '[ExtractAudio] Destination: /tmp/abc.mp3',
				stderr: '',
				filePath: '/tmp/abc.mp3',
				errorCategory: null,
				errorMessage: null,
			})
			const enoent = Object.assign(new Error("ENOENT: no such file or directory, stat 'abc.mp3'"), {
				code: 'ENOENT',
			})
			mockUploadToTigris.mockRejectedValue(enoent)

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: 'job-enoent' },
					data: expect.objectContaining({
						status: 'failed',
						retryCount: 1,
						errorHistory: expect.stringContaining('FILE_NOT_FOUND'),
					}),
				}),
			)
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
					retryCount: 3,
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

		it('flags cookies invalid and notifies on AUTH error', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-auth',
					status: 'pending',
					priority: false,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-auth', serviceUrl: 'https://youtube.com/watch?v=403' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 1,
				stdout: '',
				stderr: 'HTTP Error 403: Forbidden',
				filePath: undefined,
				errorCategory: 'AUTH',
				errorMessage: 'HTTP Error 403: Forbidden',
			})

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should flag all valid cookies as invalid
			expect(mockPrisma.youtubeCookie.updateMany).toHaveBeenCalledWith({
				where: { valid: true },
				data: { valid: false, updatedAt: expect.any(Date) },
			})

			// Should notify admin
			expect(mockNotifyCookieExpired).toHaveBeenCalledWith(
				'job-auth',
				'https://youtube.com/watch?v=403',
				'HTTP Error 403: Forbidden',
			)

			// Should NOT call notifyJobFailed (cookie notification is separate)
			expect(mockNotifyJobFailed).not.toHaveBeenCalled()
		})

		it('flags cookies invalid and notifies on COOKIE_EXPIRED error', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-cookie',
					status: 'pending',
					priority: false,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-cookie', serviceUrl: 'https://youtube.com/watch?v=cookie' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 1,
				stdout: '',
				stderr: 'ERROR: Sign in to confirm',
				filePath: undefined,
				errorCategory: 'COOKIE_EXPIRED',
				errorMessage: 'Sign in required',
			})

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			expect(mockPrisma.youtubeCookie.updateMany).toHaveBeenCalledWith({
				where: { valid: true },
				data: { valid: false, updatedAt: expect.any(Date) },
			})
			expect(mockNotifyCookieExpired).toHaveBeenCalledWith(
				'job-cookie',
				'https://youtube.com/watch?v=cookie',
				'Sign in required',
			)
			expect(mockNotifyJobFailed).not.toHaveBeenCalled()
		})

		it('notifies on GEO_BLOCKED permanent failure', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-geo',
					status: 'pending',
					priority: false,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-geo', serviceUrl: 'https://youtube.com/watch?v=geo' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: '[]' })
			mockExecuteYtDlp.mockResolvedValue({
				exitCode: 1,
				stdout: '',
				stderr: 'ERROR: not available in your country',
				filePath: undefined,
				errorCategory: 'GEO_BLOCKED',
				errorMessage: 'Not available in your country',
			})

			const { processQueueTick } = await import('./worker.server.ts')
			await processQueueTick()

			// Should NOT flag cookies (not auth/cookie related)
			expect(mockPrisma.youtubeCookie.updateMany).not.toHaveBeenCalled()
			expect(mockNotifyCookieExpired).not.toHaveBeenCalled()

			// Should notify about geo-blocked failure
			expect(mockNotifyJobFailed).toHaveBeenCalledWith(
				'job-geo',
				'https://youtube.com/watch?v=geo',
				'GEO_BLOCKED',
				'Not available in your country',
			)
		})

		it('does not notify for retriable errors under max retries', async () => {
			mockPrisma.archiveJob.count.mockResolvedValue(0)
			mockPrisma.archiveJob.findMany.mockResolvedValue([
				{
					id: 'job-net',
					status: 'pending',
					priority: false,
					retryCount: 0,
					errorHistory: '[]',
					track: { id: 'track-net', serviceUrl: 'https://youtube.com/watch?v=net' },
				},
			])
			mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: '[]' })
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

			// Should NOT notify (retriable, will be retried)
			expect(mockNotifyCookieExpired).not.toHaveBeenCalled()
			expect(mockNotifyJobFailed).not.toHaveBeenCalled()
			expect(mockPrisma.youtubeCookie.updateMany).not.toHaveBeenCalled()
		})
	})
})

describe('getQueueStats', () => {
	it('returns counts for all statuses', async () => {
		mockPrisma.archiveJob.count
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(10)
			.mockResolvedValueOnce(2)

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
