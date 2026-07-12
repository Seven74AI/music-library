import { describe, expect, test, vi, beforeEach } from 'vitest'
import { type YouTubePlaylistItem } from '#app/types/youtube-api'
import { createYouTubePlaylistProvider, type YouTubePlaylistProvider } from './youtube-playlist-provider.server'

// Mock YouTube service internals — provider tests don't need real API calls
vi.mock('./youtube.server', () => ({
	createYouTubeService: vi.fn(() => ({
		getPlaylistItems: vi.fn(),
		getPlaylist: vi.fn(),
		getUserPlaylists: vi.fn(),
	})),
}))

describe('YouTubePlaylistProvider - Deleted Video Detection', () => {
	let provider: YouTubePlaylistProvider

	beforeEach(() => {
		provider = createYouTubePlaylistProvider()
		vi.clearAllMocks()
	})

	describe('isDeletedVideo', () => {
		test('detects deleted video by title pattern', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Deleted video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			const result = provider.isDeletedVideo(item)
			expect(result).toBe(true)
		})

		test('detects private video by title pattern', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Private video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			const result = provider.isDeletedVideo(item)
			expect(result).toBe(true)
		})

		test('detects unavailable video by title pattern', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Unavailable video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			const result = provider.isDeletedVideo(item)
			expect(result).toBe(true)
		})

		test('detects deleted video by missing video ID', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Some Video Title',
					resourceId: {
						videoId: '',
					},
				},
			}

			const result = provider.isDeletedVideo(item)
			expect(result).toBe(true)
		})

		test('detects deleted video by missing thumbnail', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Some Video Title',
					resourceId: {
						videoId: 'test123',
					},
					thumbnails: {},
				},
			}

			const result = provider.isDeletedVideo(item)
			expect(result).toBe(true)
		})

		test('returns false for valid video', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Valid Video Title',
					resourceId: {
						videoId: 'test123',
					},
					thumbnails: {
						default: {
							url: 'https://example.com/thumb.jpg',
						},
					},
				},
			}

			const result = provider.isDeletedVideo(item)
			expect(result).toBe(false)
		})
	})

	describe('shouldPreserveTrackData', () => {
		test('preserves data when video is deleted and has original title', () => {
			const existingTrack = {
				title: 'Original Video Title',
			}
			const newItem: YouTubePlaylistItem = {
				snippet: {
					title: 'Deleted video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			const result = provider.shouldPreserveTrackData(existingTrack, newItem)
			expect(result).toBe(true)
		})

		test('does not preserve data when existing track has "Deleted video" title', () => {
			const existingTrack = {
				title: 'Deleted video',
			}
			const newItem: YouTubePlaylistItem = {
				snippet: {
					title: 'Deleted video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			const result = provider.shouldPreserveTrackData(existingTrack, newItem)
			expect(result).toBe(false)
		})

		test('does not preserve data when video is not deleted', () => {
			const existingTrack = {
				title: 'Original Video Title',
			}
			const newItem: YouTubePlaylistItem = {
				snippet: {
					title: 'Updated Video Title',
					resourceId: {
						videoId: 'test123',
					},
					thumbnails: {
						default: {
							url: 'https://example.com/thumb.jpg',
						},
					},
				},
			}

			const result = provider.shouldPreserveTrackData(existingTrack, newItem)
			expect(result).toBe(false)
		})

		test('returns false when no existing track', () => {
			const newItem: YouTubePlaylistItem = {
				snippet: {
					title: 'Deleted video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			const result = provider.shouldPreserveTrackData(null, newItem)
			expect(result).toBe(false)
		})
	})
})
