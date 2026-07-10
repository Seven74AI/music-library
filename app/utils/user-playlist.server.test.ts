import { describe, expect, test, vi, beforeEach } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { addTrackToUserPlaylist } from './user-playlist.server'

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		userPlaylist: {
			findFirst: vi.fn(),
		},
		userPlaylistTrack: {
			findFirst: vi.fn(),
			aggregate: vi.fn(),
			create: vi.fn(),
		},
	},
}))

describe('addTrackToUserPlaylist', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('adds track when playlist exists and track is not a duplicate', async () => {
		vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
			id: 'playlist-1',
			title: 'My Playlist',
		} as never)
		vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue(null)
		vi.mocked(prisma.userPlaylistTrack.aggregate).mockResolvedValue({
			_max: { position: 2 },
		} as never)
		vi.mocked(prisma.userPlaylistTrack.create).mockResolvedValue({} as never)

		const result = await addTrackToUserPlaylist({
			userId: 'user-1',
			playlistId: 'playlist-1',
			trackId: 'track-1',
		})

		expect(result).toEqual({
			status: 'success',
			playlistTitle: 'My Playlist',
		})
		expect(prisma.userPlaylistTrack.create).toHaveBeenCalledWith({
			data: {
				playlistId: 'playlist-1',
				trackId: 'track-1',
				position: 3,
			},
		})
	})

	test('returns not_found when playlist does not belong to user', async () => {
		vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue(null)

		const result = await addTrackToUserPlaylist({
			userId: 'user-1',
			playlistId: 'playlist-1',
			trackId: 'track-1',
		})

		expect(result).toEqual({ status: 'not_found' })
		expect(prisma.userPlaylistTrack.create).not.toHaveBeenCalled()
	})

	test('returns duplicate when track already exists in playlist', async () => {
		vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
			id: 'playlist-1',
			title: 'My Playlist',
		} as never)
		vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue({
			id: 'existing',
		} as never)

		const result = await addTrackToUserPlaylist({
			userId: 'user-1',
			playlistId: 'playlist-1',
			trackId: 'track-1',
		})

		expect(result).toEqual({
			status: 'duplicate',
			playlistId: 'playlist-1',
			playlistTitle: 'My Playlist',
		})
		expect(prisma.userPlaylistTrack.create).not.toHaveBeenCalled()
	})

	test('allows duplicate when forceDuplicate is true', async () => {
		vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
			id: 'playlist-1',
			title: 'My Playlist',
		} as never)
		vi.mocked(prisma.userPlaylistTrack.aggregate).mockResolvedValue({
			_max: { position: null },
		} as never)
		vi.mocked(prisma.userPlaylistTrack.create).mockResolvedValue({} as never)

		const result = await addTrackToUserPlaylist({
			userId: 'user-1',
			playlistId: 'playlist-1',
			trackId: 'track-1',
			forceDuplicate: true,
		})

		expect(result.status).toBe('success')
		expect(prisma.userPlaylistTrack.findFirst).not.toHaveBeenCalled()
		expect(prisma.userPlaylistTrack.create).toHaveBeenCalledWith({
			data: {
				playlistId: 'playlist-1',
				trackId: 'track-1',
				position: 0,
			},
		})
	})
})
