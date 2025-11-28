import { describe, expect, test, vi, beforeEach } from 'vitest'
import { type YouTubePlaylistItem } from '#app/types/youtube-api'
import { createServicePlaylistService, type ServicePlaylistService } from './service-playlist.server'

// Mock all external dependencies - must be defined inside factory functions
vi.mock('#app/utils/db.server', () => ({
	prisma: {
		service: {
			findUnique: vi.fn(),
		},
		connection: {
			findFirst: vi.fn(),
		},
		servicePlaylist: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		servicePlaylistTrack: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
			deleteMany: vi.fn(),
		},
		track: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
		},
		$transaction: vi.fn(),
		$disconnect: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock('./youtube.server', () => ({
	createYouTubeService: vi.fn(() => ({
		getPlaylistItems: vi.fn(),
	})),
}))

vi.mock('#app/utils/youtube-oauth-validation.server', () => ({
	validateYouTubeOAuth: vi.fn(),
}))

describe('ServicePlaylistService - Deleted Video Detection', () => {
	let service: ServicePlaylistService

	beforeEach(() => {
		service = createServicePlaylistService()
		vi.clearAllMocks()
	})

	describe('isDeletedYouTubeVideo', () => {
		test('detects deleted video by title pattern', () => {
			const item: YouTubePlaylistItem = {
				snippet: {
					title: 'Deleted video',
					resourceId: {
						videoId: 'test123',
					},
				},
			}

			// Access private method via type assertion
			const result = (service as any).isDeletedYouTubeVideo(item)
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

			const result = (service as any).isDeletedYouTubeVideo(item)
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

			const result = (service as any).isDeletedYouTubeVideo(item)
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

			const result = (service as any).isDeletedYouTubeVideo(item)
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

			const result = (service as any).isDeletedYouTubeVideo(item)
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

			const result = (service as any).isDeletedYouTubeVideo(item)
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

			const result = (service as any).shouldPreserveTrackData(existingTrack, newItem)
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

			const result = (service as any).shouldPreserveTrackData(existingTrack, newItem)
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

			const result = (service as any).shouldPreserveTrackData(existingTrack, newItem)
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

			const result = (service as any).shouldPreserveTrackData(null, newItem)
			expect(result).toBe(false)
		})
	})
})

describe('ServicePlaylistService - Sync Logic', () => {
	let service: ServicePlaylistService
	let prisma: any
	let createYouTubeService: any

	beforeEach(async () => {
		service = createServicePlaylistService()
		prisma = (await import('#app/utils/db.server')).prisma
		createYouTubeService = (await import('./youtube.server')).createYouTubeService
		vi.clearAllMocks()
	})

	describe('syncPlaylistTracks - removed tracks cleanup', () => {
		test('removes tracks that are no longer in YouTube playlist', async () => {
			const userId = 'user123'
			const playlistId = 'playlist123'
			const serviceId = 'youtube-service'

			// Mock service lookup
			vi.mocked(prisma.service.findUnique).mockResolvedValue({
				id: serviceId,
				name: 'youtube',
				displayName: 'YouTube',
				baseUrl: 'https://youtube.com',
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any)

			// Mock connection
			vi.mocked(prisma.connection.findFirst).mockResolvedValue({
				id: 'conn123',
				providerName: 'youtube',
				providerId: 'provider123',
				userId,
				tokens: JSON.stringify({ access_token: 'token123' }),
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any)

			// Mock playlist
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue({
				id: playlistId,
				serviceId,
				externalId: 'external123',
				title: 'Test Playlist',
				itemCount: 0,
				ownerId: userId,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any)

			// Mock YouTube service
			vi.mocked(createYouTubeService).mockReturnValue({
				getPlaylistItems: vi.fn().mockResolvedValue([
					{
						snippet: {
							title: 'Video 1',
							resourceId: { videoId: 'video1' },
							thumbnails: { default: { url: 'thumb1.jpg' } },
						},
					},
				] as any),
			} as any)

			// Mock existing playlist tracks (one that should be removed)
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue([
				{
					id: 'pt1',
					playlistId,
					trackId: 'track1',
					position: 1,
					isDeleted: false,
					deletedAt: null,
					track: {
						id: 'track1',
						title: 'Video 1',
						externalId: 'video1',
					},
				},
				{
					id: 'pt2',
					playlistId,
					trackId: 'track2',
					position: 2,
					isDeleted: false,
					deletedAt: null,
					track: {
						id: 'track2',
						title: 'Video 2 (Removed)',
						externalId: 'video2',
					},
				},
			] as any)

			// Mock transaction
			vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
				const tx = {
					track: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'track1',
							title: 'Video 1',
							externalId: 'video1',
						}),
					},
					servicePlaylistTrack: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'pt1',
							playlistId,
							trackId: 'track1',
							position: 1,
							isDeleted: false,
						}),
					},
				}
				return callback(tx)
			})

			// Mock playlist update
			vi.mocked(prisma.servicePlaylist.update).mockResolvedValue({} as any)

			// Mock deleteMany for removed tracks
			vi.mocked(prisma.servicePlaylistTrack.deleteMany).mockResolvedValue({ count: 1 } as any)

			const result = await service.syncPlaylistTracks('youtube', playlistId, userId)

			expect(result.success).toBe(true)
			expect(result.removedTracks).toHaveLength(1)
			expect(result.removedTracks[0]?.title).toBe('Video 2 (Removed)')
			expect(result.removedTracks[0]?.externalId).toBe('video2')
			expect(prisma.servicePlaylistTrack.deleteMany).toHaveBeenCalledWith({
				where: {
					id: {
						in: ['pt2'],
					},
				},
			})
		})

		test('tracks deleted videos during sync', async () => {
			const userId = 'user123'
			const playlistId = 'playlist123'
			const serviceId = 'youtube-service'

			// Mock service lookup
			vi.mocked(prisma.service.findUnique).mockResolvedValue({
				id: serviceId,
				name: 'youtube',
				displayName: 'YouTube',
				baseUrl: 'https://youtube.com',
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any)

			// Mock connection
			vi.mocked(prisma.connection.findFirst).mockResolvedValue({
				id: 'conn123',
				providerName: 'youtube',
				providerId: 'provider123',
				userId,
				tokens: JSON.stringify({ access_token: 'token123' }),
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any)

			// Mock playlist
			vi.mocked(prisma.servicePlaylist.findFirst).mockResolvedValue({
				id: playlistId,
				serviceId,
				externalId: 'external123',
				title: 'Test Playlist',
				itemCount: 0,
				ownerId: userId,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as any)

			// Mock YouTube service with deleted video
			vi.mocked(createYouTubeService).mockReturnValue({
				getPlaylistItems: vi.fn().mockResolvedValue([
					{
						snippet: {
							title: 'Deleted video',
							resourceId: { videoId: 'video1' },
						},
					},
				] as any),
			} as any)

			// Mock existing track with original title
			const existingTrack = {
				id: 'track1',
				title: 'Original Video Title',
				artist: 'Original Artist',
				thumbnailUrl: 'original-thumb.jpg',
				externalId: 'video1',
			}

			// Mock transaction
			vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
				const tx = {
					track: {
						findUnique: vi.fn().mockResolvedValue(existingTrack),
						upsert: vi.fn().mockResolvedValue({
							id: 'track1',
							title: 'Original Video Title', // Should be preserved
							externalId: 'video1',
						}),
					},
					servicePlaylistTrack: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'pt1',
							playlistId,
							trackId: 'track1',
							position: 1,
							isDeleted: true,
							deletedAt: new Date(),
						}),
					},
				}
				return callback(tx)
			})

			// Mock playlist tracks query (empty - no removed tracks)
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue([])

			// Mock playlist update
			vi.mocked(prisma.servicePlaylist.update).mockResolvedValue({} as any)

			const result = await service.syncPlaylistTracks('youtube', playlistId, userId)

			expect(result.success).toBe(true)
			expect(result.deletedTracks).toHaveLength(1)
			expect(result.deletedTracks[0]?.title).toBe('Original Video Title')
			expect(result.deletedTracks[0]?.externalId).toBe('video1')
		})
	})
})

