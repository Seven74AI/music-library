import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import { createServicePlaylistService } from '#app/features/service-playlist/service-playlist.server'
import { getSyncedPlaylistsTrackStats } from '#app/features/service-playlist/playlist-utils.server'
import { loader } from './synced-playlists.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/features/service-playlist/service-playlist.server', () => ({
	createServicePlaylistService: vi.fn(),
}))

vi.mock('#app/features/service-playlist/playlist-utils.server', () => ({
	getSyncedPlaylistsTrackStats: vi.fn(),
}))

vi.mock('#app/utils/error-handlers.server', () => ({
	handleLoaderError: vi.fn(
		(_error: unknown, fallback: unknown, _context: string) => ({
			data: fallback,
		}),
	),
}))

function makeRequest() {
	return new Request('http://localhost/music/services/youtube/synced-playlists', {
		method: 'GET',
	})
}

const mockPlaylists = [
	{
		id: 'sp-1',
		title: 'Chill Vibes',
		description: 'Relaxing music',
		externalId: 'PL123',
		serviceId: 'svc-1',
		ownerId: 'user-1',
		itemCount: 50,
		channelTitle: 'Music Channel',
		thumbnailUrl: 'https://img.example.com/thumb.jpg',
		isActive: true,
		createdAt: new Date(),
		updatedAt: new Date(),
		lastSyncedAt: new Date(),
	},
]

describe('synced-playlists loader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
	})

	test('returns playlists with track counts', async () => {
		const mockService = {
			getSyncedPlaylists: vi.fn().mockResolvedValue(mockPlaylists),
		}
		vi.mocked(createServicePlaylistService).mockReturnValue(
			mockService as any,
		)
		vi.mocked(getSyncedPlaylistsTrackStats).mockResolvedValue({
			totalTracks: 150,
			missingTracks: 42,
		})

		const response = await loader({ request: makeRequest() } as never)

		expect(response.data).toEqual({
			playlists: mockPlaylists,
			totalTracks: 150,
			missingTracks: 42,
		})
		expect(mockService.getSyncedPlaylists).toHaveBeenCalledWith(
			'youtube',
			'user-1',
		)
	})

	test('returns zero counts for user with no playlists', async () => {
		const mockService = {
			getSyncedPlaylists: vi.fn().mockResolvedValue([]),
		}
		vi.mocked(createServicePlaylistService).mockReturnValue(
			mockService as any,
		)
		vi.mocked(getSyncedPlaylistsTrackStats).mockResolvedValue({
			totalTracks: 0,
			missingTracks: 0,
		})

		const response = await loader({ request: makeRequest() } as never)

		expect(response.data).toEqual({
			playlists: [],
			totalTracks: 0,
			missingTracks: 0,
		})
	})
})
