import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { loader } from './track-details.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		track: {
			findUnique: vi.fn(),
		},
	},
}))

function makeRequest(searchParams?: string) {
	return new Request(
		`http://localhost/resources/track-details${searchParams ? `?${searchParams}` : ''}`,
		{ method: 'GET' },
	)
}

describe('track-details loader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
	})

	test('returns 400 when trackId is missing', async () => {
		try {
			await loader({ request: makeRequest() } as never)
			expect.unreachable('loader should have thrown')
		} catch (e) {
			expect(e).toBeInstanceOf(Response)
			expect((e as Response).status).toBe(400)
		}
	})

	test('returns 404 for nonexistent track', async () => {
		vi.mocked(prisma.track.findUnique).mockResolvedValue(null)

		try {
			await loader({ request: makeRequest('trackId=nonexistent') } as never)
			expect.unreachable('loader should have thrown')
		} catch (e) {
			expect(e).toBeInstanceOf(Response)
			expect((e as Response).status).toBe(404)
		}
	})

	test('returns track details for valid track', async () => {
		const mockTrack = {
			id: 'track-1',
			title: 'Test Song',
			artist: { id: 'artist-1', name: 'Test Artist' },
			duration: 180,
			createdAt: new Date('2025-01-01'),
			coverImage: { objectKey: 'covers/test.jpg' },
			service: { displayName: 'YouTube' },
			serviceUrl: 'https://youtube.com/watch?v=abc',
		}
		vi.mocked(prisma.track.findUnique).mockResolvedValue(mockTrack as any)

		const response = await loader({
			request: makeRequest('trackId=track-1'),
		} as never)

		expect(response.data).toEqual({ track: mockTrack })
		expect(prisma.track.findUnique).toHaveBeenCalledWith({
			where: { id: 'track-1' },
			select: expect.objectContaining({
				id: true,
				title: true,
				artist: { select: { id: true, name: true } },
				duration: true,
				createdAt: true,
				coverImage: { select: { objectKey: true } },
				service: { select: { displayName: true } },
				serviceUrl: true,
			}),
		})
	})

	test('returns track with null service fields', async () => {
		const mockTrack = {
			id: 'track-1',
			title: 'Local Track',
			artist: { id: 'artist-1', name: 'Artist' },
			duration: null,
			createdAt: new Date('2025-01-01'),
			coverImage: null,
			service: null,
			serviceUrl: null,
		}
		vi.mocked(prisma.track.findUnique).mockResolvedValue(mockTrack as any)

		const response = await loader({
			request: makeRequest('trackId=track-1'),
		} as never)

		expect(response.data).toEqual({ track: mockTrack })
	})
})
