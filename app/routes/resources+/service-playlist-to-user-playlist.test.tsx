import { describe, expect, test, vi, beforeEach } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { userPlaylistTitleTaken } from '#app/utils/user-playlist.server.ts'
import { action } from './service-playlist-to-user-playlist.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		servicePlaylist: {
			findFirst: vi.fn(),
		},
		servicePlaylistTrack: {
			findMany: vi.fn(),
		},
		userPlaylist: {
			create: vi.fn(),
			findFirst: vi.fn(),
		},
		userPlaylistTrack: {
			findMany: vi.fn(),
			createMany: vi.fn(),
			aggregate: vi.fn(),
		},
		$transaction: vi.fn(),
	},
}))

vi.mock('#app/utils/user-playlist.server.ts', () => ({
	userPlaylistTitleTaken: vi.fn(),
	normalizeUserPlaylistTitle: (t: string) => t.trim().toLowerCase(),
}))

vi.mock('#app/utils/toast.server.ts', () => ({
	createToastHeaders: vi.fn().mockResolvedValue({}),
}))

function makeRequest(formData: FormData) {
	return new Request(
		'http://localhost/resources/service-playlist-to-user-playlist',
		{ method: 'POST', body: formData },
	)
}

const mockServicePlaylist = {
	id: 'sp-1',
	title: 'Chill Vibes',
}

const mockTrackIds = ['track-1', 'track-2', 'track-3']

describe('service-playlist-to-user-playlist action', () => {
	beforeEach(() => {
		consoleError.mockImplementation(() => {})
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
	})

	describe('validation', () => {
		test('returns 400 when playlistId is missing', async () => {
			const fd = new FormData()
			fd.append('action', 'create')
			fd.append('title', 'My Playlist')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: { status: 'error', message: 'Invalid playlist ID' },
			})
		})

		test('returns 404 when service playlist not found or not owned', async () => {
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue(null)

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'create')
			fd.append('title', 'My Playlist')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: {
					status: 'error',
					message: 'Playlist not found or access denied',
				},
			})
		})

		test('returns 400 when action is invalid', async () => {
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue(
				mockServicePlaylist as any,
			)
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue(
				mockTrackIds.map((id) => ({ trackId: id })) as any,
			)

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'delete')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response.data.message).toContain('Invalid action')
		})
	})

	describe('no tracks', () => {
		test('returns success with 0 when playlist has no tracks', async () => {
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue(
				mockServicePlaylist as any,
			)
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue([])

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'create')
			fd.append('title', 'My Playlist')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: { status: 'success', addedCount: 0, skippedCount: 0 },
			})
		})
	})

	describe('create mode', () => {
		beforeEach(() => {
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue(
				mockServicePlaylist as any,
			)
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue(
				mockTrackIds.map((id) => ({ trackId: id })) as any,
			)
		})

		test('returns 400 when title is empty', async () => {
			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'create')
			fd.append('title', '  ')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: { status: 'error', message: 'Playlist name is required' },
			})
		})

		test('returns 409 when title is duplicate', async () => {
			vi.mocked(userPlaylistTitleTaken).mockResolvedValue({
				taken: true,
				existingTitle: 'Chill Vibes',
			})

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'create')
			fd.append('title', 'Chill Vibes')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: { status: 'duplicate_title' },
			})
		})

		test('creates playlist and bulk-adds tracks in transaction', async () => {
			vi.mocked(userPlaylistTitleTaken).mockResolvedValue({ taken: false })
			vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) =>
				fn({
					userPlaylist: {
						create: vi
							.fn()
							.mockResolvedValue({ id: 'up-1', title: 'Chill Vibes' }),
					},
					userPlaylistTrack: { createMany: vi.fn().mockResolvedValue({}) },
				}),
			)

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'create')
			fd.append('title', 'Chill Vibes')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: {
					status: 'success',
					addedCount: 3,
					skippedCount: 0,
				},
			})
		})
	})

	describe('add mode', () => {
		beforeEach(() => {
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue(
				mockServicePlaylist as any,
			)
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue(
				mockTrackIds.map((id) => ({ trackId: id })) as any,
			)
		})

		test('returns 400 when targetPlaylistId is missing', async () => {
			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'add')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: { status: 'error', message: 'Invalid target playlist ID' },
			})
		})

		test('returns 404 when target playlist not found', async () => {
			vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue(null)

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'add')
			fd.append('targetPlaylistId', 'nonexistent')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: {
					status: 'error',
					message: 'Target playlist not found',
				},
			})
		})

		test('skips duplicates and reports counts', async () => {
			vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
				id: 'up-1',
				title: 'My Playlist',
			} as any)

			// track-1 already exists, track-2 and track-3 are new
			vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValueOnce(
				[{ trackId: 'track-1' }] as any,
			)
			vi.mocked(prisma.userPlaylistTrack.aggregate).mockResolvedValue(
				{ _max: { position: 5 } } as any,
			)

			vi.mocked(prisma.userPlaylistTrack.createMany).mockResolvedValue(
				{} as any,
			)

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'add')
			fd.append('targetPlaylistId', 'up-1')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: {
					status: 'success',
					addedCount: 2,
					skippedCount: 1,
				},
			})
		})

		test('returns success when all tracks already in target', async () => {
			vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
				id: 'up-1',
				title: 'My Playlist',
			} as any)

			// All three tracks already exist
			vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue(
				mockTrackIds.map((id) => ({ trackId: id })) as any,
			)

			const fd = new FormData()
			fd.append('playlistId', 'sp-1')
			fd.append('action', 'add')
			fd.append('targetPlaylistId', 'up-1')

			const response = await action({
				request: makeRequest(fd),
			} as never)

			expect(response).toMatchObject({
				data: { status: 'success', addedCount: 0, skippedCount: 3 },
			})
		})
	})
})
