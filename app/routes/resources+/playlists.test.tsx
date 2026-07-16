import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { loader } from './playlists.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		userPlaylist: {
			findMany: vi.fn(),
		},
	},
}))

function makeRequest() {
	return new Request('http://localhost/resources/playlists', {
		method: 'GET',
	})
}

describe('playlists loader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
	})

	test('returns 401 when unauthenticated', async () => {
		vi.mocked(requireUserId).mockRejectedValue(
			new Response('Unauthorized', { status: 401 }),
		)

		try {
			await loader({ request: makeRequest() } as never)
			expect.unreachable('loader should have thrown')
		} catch (e) {
			expect(e).toBeInstanceOf(Response)
			expect((e as Response).status).toBe(401)
		}
	})

	test('returns empty playlists array for user with no playlists', async () => {
		vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([] as any)

		const response = await loader({ request: makeRequest() } as never)

		expect(response.data).toEqual({ playlists: [] })
		expect(prisma.userPlaylist.findMany).toHaveBeenCalledWith({
			where: { ownerId: 'user-1' },
			select: {
				id: true,
				title: true,
				description: true,
				_count: { select: { tracks: true } },
			},
			orderBy: { updatedAt: 'desc' },
		})
	})

	test('returns user playlists with correct shape', async () => {
		const mockPlaylists = [
			{
				id: 'pl-1',
				title: 'My Playlist',
				description: 'A test playlist',
				_count: { tracks: 5 },
			},
		]
		vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue(mockPlaylists as any)

		const response = await loader({ request: makeRequest() } as never)

		expect(response.data).toEqual({ playlists: mockPlaylists })
	})
})
