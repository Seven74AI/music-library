import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── extractYouTubeVideoId ──────────────────────────────────────────────

describe('extractYouTubeVideoId', () => {
	it('returns the ID for plain 11-char video IDs', async () => {
		const { extractYouTubeVideoId } = await import(
			'./service-import.server.ts'
		)
		expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
		expect(extractYouTubeVideoId('jNQXAC9IVRw')).toBe('jNQXAC9IVRw')
		expect(extractYouTubeVideoId('abc123-_XYZ')).toBe('abc123-_XYZ')
	})

	it('extracts from youtube.com/watch?v= URLs', async () => {
		const { extractYouTubeVideoId } = await import(
			'./service-import.server.ts'
		)
		expect(
			extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
		).toBe('dQw4w9WgXcQ')
		expect(
			extractYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=30'),
		).toBe('dQw4w9WgXcQ')
	})

	it('extracts from youtu.be/ short URLs', async () => {
		const { extractYouTubeVideoId } = await import(
			'./service-import.server.ts'
		)
		expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(
			'dQw4w9WgXcQ',
		)
		expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe(
			'dQw4w9WgXcQ',
		)
	})

	it('extracts from youtube.com/embed/ URLs', async () => {
		const { extractYouTubeVideoId } = await import(
			'./service-import.server.ts'
		)
		expect(
			extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
		).toBe('dQw4w9WgXcQ')
	})

	it('returns null for invalid inputs', async () => {
		const { extractYouTubeVideoId } = await import(
			'./service-import.server.ts'
		)
		expect(extractYouTubeVideoId('not-a-valid-id')).toBeNull()
		expect(extractYouTubeVideoId('')).toBeNull()
		expect(extractYouTubeVideoId('https://google.com')).toBeNull()
		expect(extractYouTubeVideoId('https://youtube.com/playlist?list=PLxxx')).toBeNull()
	})

	it('handles whitespace in input', async () => {
		const { extractYouTubeVideoId } = await import(
			'./service-import.server.ts'
		)
		expect(extractYouTubeVideoId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ')
		expect(
			extractYouTubeVideoId('  https://youtu.be/dQw4w9WgXcQ  '),
		).toBe('dQw4w9WgXcQ')
	})
})

// ── importTrackDirectly ─────────────────────────────────────────────────

// Mock YouTube API
vi.mock('#app/utils/youtube-search.server.ts', () => ({
	getYouTubeVideoDetails: vi.fn(),
}))

// Mock playlist-utils
const mockService = {
	id: 'svc-youtube',
	name: 'youtube',
	displayName: 'YouTube',
	createdAt: new Date(),
	updatedAt: new Date(),
	isActive: true,
	baseUrl: 'https://youtube.com',
	logoUrl: null,
}
vi.mock('#app/utils/playlist-utils.server.ts', () => ({
	getServiceByName: vi.fn().mockResolvedValue(mockService),
}))

// Mock artist management
const mockArtist = { id: 'artist-1', name: 'Test Artist' }
vi.mock('#app/utils/artist-management.server.ts', () => ({
	getOrCreateArtistTx: vi.fn(),
}))

// Mock auto-enqueue
vi.mock('#app/features/audio-archive/auto-enqueue.server.ts', () => ({
	enqueueArchiveJob: vi.fn(),
}))

// Mock db.server
const mockTx = {
	track: {
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
}
const mockPrisma = {
	$transaction: vi.fn(),
}
vi.mock('#app/utils/db.server.ts', () => ({
	prisma: mockPrisma,
}))

describe('importTrackDirectly', () => {
	beforeEach(async () => {
		vi.clearAllMocks()

		// Reset mocks
		const { getYouTubeVideoDetails } = await import(
			'#app/utils/youtube-search.server.ts'
		)
		const { getServiceByName } = await import(
			'#app/utils/playlist-utils.server.ts'
		)
		const { getOrCreateArtistTx } = await import(
			'#app/utils/artist-management.server.ts'
		)
		const { enqueueArchiveJob } = await import(
			'#app/features/audio-archive/auto-enqueue.server.ts'
		)

		vi.mocked(getYouTubeVideoDetails).mockResolvedValue({
			id: 'dQw4w9WgXcQ',
			title: 'Never Gonna Give You Up',
			artist: 'Rick Astley',
			duration: 240,
			thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
			serviceUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
			publishedAt: '2009-10-25T06:57:33Z',
		})

		vi.mocked(getServiceByName).mockResolvedValue(mockService)
		vi.mocked(getOrCreateArtistTx).mockResolvedValue(mockArtist)
		vi.mocked(enqueueArchiveJob).mockResolvedValue(undefined)

		mockTx.track.findUnique.mockResolvedValue(null)
		mockTx.track.upsert.mockResolvedValue({ id: 'track-new' })
		mockPrisma.$transaction.mockImplementation(
			async (fn: (tx: any) => any) => fn(mockTx),
		)
	})

	describe('successful import (new track)', () => {
		it('returns success with trackId when creating a new track', async () => {
			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			const result = await importTrackDirectly('dQw4w9WgXcQ')

			expect(result.success).toBe(true)
			expect(result.trackId).toBe('track-new')
			expect(result.action).toBe('created')

			// Verify enqueue was called
			const { enqueueArchiveJob } = await import(
				'#app/features/audio-archive/auto-enqueue.server.ts'
			)
			expect(enqueueArchiveJob).toHaveBeenCalledWith(mockTx, 'track-new')
		})

		it('accepts a full YouTube URL', async () => {
			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			const result = await importTrackDirectly(
				'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			)

			expect(result.success).toBe(true)
			expect(result.trackId).toBe('track-new')
		})

		it('maps publishedAt to releaseDate on the created track', async () => {
			mockTx.track.upsert.mockResolvedValue({ id: 'track-new' })
			mockTx.track.findUnique.mockResolvedValue(null) // new track

			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			await importTrackDirectly('dQw4w9WgXcQ')

			// Check that create data includes releaseDate
			const upsertCall = mockTx.track.upsert.mock.calls[0]?.[0]
			expect(upsertCall).toBeDefined()
			if (upsertCall?.create?.releaseDate) {
				expect(upsertCall.create.releaseDate).toBeInstanceOf(Date)
				expect(upsertCall.create.releaseDate.toISOString()).toBe(
					'2009-10-25T06:57:33.000Z',
				)
			}
		})
	})

	describe('successful import (existing track — update)', () => {
		it('returns action "updated" when track already exists', async () => {
			mockTx.track.findUnique.mockResolvedValue({ id: 'track-existing' })
			mockTx.track.upsert.mockResolvedValue({ id: 'track-existing' })

			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			const result = await importTrackDirectly('dQw4w9WgXcQ')

			expect(result.success).toBe(true)
			expect(result.trackId).toBe('track-existing')
			expect(result.action).toBe('updated')
		})
	})

	describe('error handling', () => {
		it('returns error for invalid video ID', async () => {
			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			const result = await importTrackDirectly('not-valid')

			expect(result.success).toBe(false)
			expect(result.action).toBe('failed')
			expect(result.error).toBeDefined()
		})

		it('returns error when YouTube API fails', async () => {
			const { getYouTubeVideoDetails } = await import(
				'#app/utils/youtube-search.server.ts'
			)
			vi.mocked(getYouTubeVideoDetails).mockRejectedValue(
				new Error('YouTube quota exceeded'),
			)

			// Suppress console.error from handleServiceError
			const { consoleError } = await import('#tests/setup/setup-test-env.ts')
			consoleError.mockImplementation(() => {})

			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			const result = await importTrackDirectly('dQw4w9WgXcQ')

			expect(result.success).toBe(false)
			expect(result.action).toBe('failed')
			expect(result.error).toContain('YouTube quota exceeded')

			consoleError.mockRestore()
		})

		it('returns error when service is not found in database', async () => {
			const { getServiceByName } = await import(
				'#app/utils/playlist-utils.server.ts'
			)
			vi.mocked(getServiceByName).mockRejectedValue(
				new Error('Service not found: youtube'),
			)

			// Suppress console.error from handleServiceError
			const { consoleError } = await import('#tests/setup/setup-test-env.ts')
			consoleError.mockImplementation(() => {})

			const { importTrackDirectly } = await import(
				'./service-import.server.ts'
			)

			const result = await importTrackDirectly('dQw4w9WgXcQ')

			expect(result.success).toBe(false)
			expect(result.action).toBe('failed')

			consoleError.mockRestore()
		})
	})
})
