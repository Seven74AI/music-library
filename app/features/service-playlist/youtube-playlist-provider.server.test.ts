import { describe, expect, test, vi, beforeEach } from 'vitest'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { type YouTubePlaylist } from '#app/types/youtube-api'
import { createYouTubePlaylistProvider } from './youtube-playlist-provider.server'

const mockGetPlaylistItems = vi.fn()
const mockGetPlaylist = vi.fn()
const mockGetUserPlaylists = vi.fn()

vi.mock('#app/utils/youtube.server', () => ({
	createYouTubeService: vi.fn(() => ({
		getPlaylistItems: mockGetPlaylistItems,
		getPlaylist: mockGetPlaylist,
		getUserPlaylists: mockGetUserPlaylists,
	})),
}))

describe('YouTubePlaylistProvider - fetch and normalize', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('supportsService returns true only for youtube', () => {
		const provider = createYouTubePlaylistProvider()

		expect(provider.supportsService(YOUTUBE_SERVICE.NAME)).toBe(true)
		expect(provider.supportsService('spotify')).toBe(false)
	})

	test('fetchPlaylists delegates to YouTube service', async () => {
		const playlists = [{ id: 'pl1', snippet: { title: 'My Playlist' } }]
		mockGetUserPlaylists.mockResolvedValue(playlists)

		const provider = createYouTubePlaylistProvider()
		const result = await provider.fetchPlaylists('token123', 'user1')

		expect(mockGetUserPlaylists).toHaveBeenCalledWith('token123')
		expect(result).toEqual(playlists)
	})

	test('fetchPlaylist delegates to YouTube service', async () => {
		const playlist = { id: 'pl1', snippet: { title: 'My Playlist' } }
		mockGetPlaylist.mockResolvedValue(playlist)

		const provider = createYouTubePlaylistProvider()
		const result = await provider.fetchPlaylist('pl1', 'token123')

		expect(mockGetPlaylist).toHaveBeenCalledWith('pl1', 'token123')
		expect(result).toEqual(playlist)
	})

	test('fetchPlaylistItems delegates to YouTube service', async () => {
		const items = [{ snippet: { title: 'Track 1' } }]
		mockGetPlaylistItems.mockResolvedValue(items)

		const provider = createYouTubePlaylistProvider()
		const result = await provider.fetchPlaylistItems('pl1', 'token123')

		expect(mockGetPlaylistItems).toHaveBeenCalledWith('pl1', 'token123')
		expect(result).toEqual(items)
	})

	test('normalizePlaylistData maps YouTube playlist fields', () => {
		const provider = createYouTubePlaylistProvider()
		const rawPlaylist: YouTubePlaylist = {
			id: 'PLexternal123',
			snippet: {
				title: 'Summer Hits',
				description: 'Best songs',
				channelId: 'channel1',
				channelTitle: 'My Channel',
				thumbnails: {
					medium: { url: 'https://example.com/playlist.jpg' },
				},
			},
			contentDetails: {
				itemCount: 42,
			},
		}

		const result = provider.normalizePlaylistData(rawPlaylist, 'service-id', 'user-id')

		expect(result).toEqual({
			title: 'Summer Hits',
			description: 'Best songs',
			externalId: 'PLexternal123',
			itemCount: 42,
			channelId: 'channel1',
			channelTitle: 'My Channel',
			thumbnailUrl: 'https://example.com/playlist.jpg',
		})
	})
})
