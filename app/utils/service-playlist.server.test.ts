import { describe, expect, test, vi, beforeEach } from 'vitest'
import { type YouTubePlaylistItem } from '#app/types/youtube-api'
import { createServicePlaylistService, type ServicePlaylistService } from './service-playlist.server'
import { createYouTubePlaylistProvider, type YouTubePlaylistProvider } from './youtube-playlist-provider.server'

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

// YouTube service mock — shared refs allow tests to control behavior
const mockGetPlaylistItems = vi.fn()
const mockGetPlaylist = vi.fn()
const mockGetUserPlaylists = vi.fn()

vi.mock('./youtube.server', () => ({
	createYouTubeService: vi.fn(() => ({
		getPlaylistItems: mockGetPlaylistItems,
		getPlaylist: mockGetPlaylist,
		getUserPlaylists: mockGetUserPlaylists,
	})),
}))

vi.mock('#app/utils/youtube-oauth-validation.server', () => ({
	validateYouTubeOAuth: vi.fn(),
}))

vi.mock('#app/utils/cover-management.server', () => ({
	findOrCreateCoverImageTx: vi.fn().mockResolvedValue({
		id: 'cover1',
		objectKey: 'cover1.jpg',
	}),
	downloadExternalImage: vi.fn().mockRejectedValue(new Error('Invalid URL')),
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

describe('ServicePlaylistService - Sync Logic', () => {
	let service: ServicePlaylistService
	let prisma: any

	beforeEach(async () => {
		service = createServicePlaylistService()
		prisma = (await import('#app/utils/db.server')).prisma
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
					artist: {
						findMany: vi.fn().mockResolvedValue([]),
						findFirst: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({
							id: 'artist1',
							name: 'Test Artist',
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

			// Mock existing track with original title
			const existingTrack = {
				id: 'track1',
				title: 'Original Video Title',
				artistId: 'artist1',
				coverImageId: 'cover1',
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
					artist: {
						findMany: vi.fn().mockResolvedValue([]),
						findFirst: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({
							id: 'artist1',
							name: 'Original Artist',
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

describe('ServicePlaylistService - Batch Processing', () => {
	let service: ServicePlaylistService
	let prisma: any

	beforeEach(async () => {
		service = createServicePlaylistService()
		prisma = (await import('#app/utils/db.server')).prisma
		vi.clearAllMocks()
	})

	describe('Position calculation across multiple batches', () => {
		test('positions are sequential across transaction batches (50+ items)', async () => {
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

			// Create 50 playlist items (will require multiple transaction batches of 15)
			const playlistItems = Array.from({ length: 50 }, (_, i) => ({
				snippet: {
					title: `Video ${i + 1}`,
					resourceId: { videoId: `video${i + 1}` },
					thumbnails: { default: { url: `https://example.com/thumb${i + 1}.jpg` } },
					videoOwnerChannelTitle: 'Test Channel',
				},
			}))

			// Mock YouTube service

			const upsertedPositions: number[] = []

			// Mock transaction - track positions
			vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
				const tx = {
					track: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockImplementation(async (args: any) => ({
							id: `track-${args.where.serviceId_externalId.externalId}`,
							title: args.create.title,
							externalId: args.create.externalId,
						})),
					},
					artist: {
						findMany: vi.fn().mockResolvedValue([]),
						findFirst: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({
							id: 'artist1',
							name: 'Test Channel',
						}),
					},
					servicePlaylistTrack: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockImplementation(async (args: any) => {
							upsertedPositions.push(args.create.position)
							return {
								id: `pt-${args.create.trackId}`,
								playlistId: args.create.playlistId,
								trackId: args.create.trackId,
								position: args.create.position,
								isDeleted: false,
							}
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
			expect(result.tracksAdded).toBe(50)
			
			// Verify positions are sequential: 1, 2, 3, ..., 50
			expect(upsertedPositions).toHaveLength(50)
			expect(upsertedPositions[0]).toBe(1)
			expect(upsertedPositions[49]).toBe(50)
			
			// Verify no position is duplicated or skipped
			const sortedPositions = [...upsertedPositions].sort((a, b) => a - b)
			expect(sortedPositions).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
		})
	})

	describe('Orphaned track detection across batches', () => {
		test('only detects truly orphaned tracks, not tracks in current sync', async () => {
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

			// Create 30 playlist items (2 transaction batches)
			// Include one deleted video without match
			const playlistItems = [
				...Array.from({ length: 14 }, (_, i) => ({
					snippet: {
						title: `Video ${i + 1}`,
						resourceId: { videoId: `video${i + 1}` },
						thumbnails: { default: { url: `https://example.com/thumb${i + 1}.jpg` } },
						videoOwnerChannelTitle: 'Test Channel',
					},
				})),
				{
					id: 'deleted-item-1',
					snippet: {
						title: 'Deleted video',
						resourceId: { videoId: '' },
					},
				},
				...Array.from({ length: 15 }, (_, i) => ({
					snippet: {
						title: `Video ${i + 16}`,
						resourceId: { videoId: `video${i + 16}` },
						thumbnails: { default: { url: `https://example.com/thumb${i + 16}.jpg` } },
						videoOwnerChannelTitle: 'Test Channel',
					},
				})),
			]

			// Mock YouTube service

			// Mock existing playlist tracks (some orphaned, some in current sync)
			const existingOrphanedTrack = {
				id: 'pt-orphaned',
				playlistId,
				trackId: 'track-orphaned',
				position: 100,
				isDeleted: false,
				track: {
					id: 'track-orphaned',
					title: 'Orphaned Track',
					externalId: 'orphaned-video',
				},
			}

			// Mock transaction
			let processedTrackIds = new Set<string>()
			vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
				const tx = {
					track: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockImplementation(async (args: any) => {
							const trackId = `track-${args.where.serviceId_externalId.externalId}`
							processedTrackIds.add(trackId)
							return {
								id: trackId,
								title: args.create.title,
								externalId: args.create.externalId,
							}
						}),
					},
					artist: {
						findMany: vi.fn().mockResolvedValue([]),
						findFirst: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({
							id: 'artist1',
							name: 'Test Channel',
						}),
					},
					servicePlaylistTrack: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockImplementation(async (args: any) => {
							processedTrackIds.add(args.create.trackId)
							return {
								id: `pt-${args.create.trackId}`,
								playlistId: args.create.playlistId,
								trackId: args.create.trackId,
								position: args.create.position,
								isDeleted: false,
							}
						}),
						findMany: vi.fn().mockResolvedValue([existingOrphanedTrack]),
					},
				}
				return callback(tx)
			})

			// Mock playlist tracks query for removal detection
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue([
				existingOrphanedTrack,
			] as any)

			// Mock playlist update
			vi.mocked(prisma.servicePlaylist.update).mockResolvedValue({} as any)

			const result = await service.syncPlaylistTracks('youtube', playlistId, userId)

			expect(result.success).toBe(true)
			
			// Should have pending matches for deleted video
			expect(result.pendingMatches.length).toBeGreaterThan(0)
			
			// Orphaned track should be in candidates
			const deletedVideoMatch = result.pendingMatches.find(
				m => m.deletedVideo.title === 'Deleted video'
			)
			expect(deletedVideoMatch).toBeDefined()
			
			// Should include orphaned track as candidate
			const orphanedCandidate = deletedVideoMatch?.candidateTracks.find(
				t => t.id === 'track-orphaned'
			)
			expect(orphanedCandidate).toBeDefined()
			
			// Should NOT include tracks from current sync as candidates
			const currentSyncTracks = deletedVideoMatch?.candidateTracks.filter(
				t => t.externalId?.startsWith('video')
			)
			expect(currentSyncTracks?.length).toBe(0)
		})
	})

	describe('Track removal across batches', () => {
		test('correctly identifies removed tracks using accumulated processedExternalIds', async () => {
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

			// Create 20 playlist items (video1-video20)
			const playlistItems = Array.from({ length: 20 }, (_, i) => ({
				snippet: {
					title: `Video ${i + 1}`,
					resourceId: { videoId: `video${i + 1}` },
					thumbnails: { default: { url: `https://example.com/thumb${i + 1}.jpg` } },
					videoOwnerChannelTitle: 'Test Channel',
				},
			}))

			// Mock YouTube service

			// Mock existing playlist tracks (video21 and video22 should be removed)
			const existingPlaylistTracks = [
				{
					id: 'pt-removed1',
					playlistId,
					trackId: 'track-removed1',
					position: 21,
					isDeleted: false,
					track: {
						id: 'track-removed1',
						title: 'Video 21 (Removed)',
						externalId: 'video21',
					},
				},
				{
					id: 'pt-removed2',
					playlistId,
					trackId: 'track-removed2',
					position: 22,
					isDeleted: false,
					track: {
						id: 'track-removed2',
						title: 'Video 22 (Removed)',
						externalId: 'video22',
					},
				},
			]

			// Mock transaction
			vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
				const tx = {
					track: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'track-new',
							title: 'New Video',
							externalId: 'video-new',
						}),
					},
					artist: {
						findMany: vi.fn().mockResolvedValue([]),
						findFirst: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({
							id: 'artist1',
							name: 'Test Channel',
						}),
					},
					servicePlaylistTrack: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'pt-new',
							playlistId,
							trackId: 'track-new',
							position: 1,
							isDeleted: false,
						}),
					},
				}
				return callback(tx)
			})

			// Mock playlist tracks query for removal detection
			vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValue(
				existingPlaylistTracks as any
			)

			// Mock playlist update
			vi.mocked(prisma.servicePlaylist.update).mockResolvedValue({} as any)

			// Mock deleteMany
			vi.mocked(prisma.servicePlaylistTrack.deleteMany).mockResolvedValue({ count: 2 } as any)

			const result = await service.syncPlaylistTracks('youtube', playlistId, userId)

			expect(result.success).toBe(true)
			expect(result.removedTracks).toHaveLength(2)
			expect(result.removedTracks.map(t => t.externalId)).toContain('video21')
			expect(result.removedTracks.map(t => t.externalId)).toContain('video22')
			
			// Verify deleteMany was called with correct IDs
			expect(prisma.servicePlaylistTrack.deleteMany).toHaveBeenCalledWith({
				where: {
					id: {
						in: ['pt-removed1', 'pt-removed2'],
					},
				},
			})
		})
	})

	describe('Processed count accuracy', () => {
		test('counts only successfully processed tracks, excludes pending matches', async () => {
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

			// Create playlist with 5 normal videos and 1 deleted video without match
			const playlistItems = [
				...Array.from({ length: 5 }, (_, i) => ({
					snippet: {
						title: `Video ${i + 1}`,
						resourceId: { videoId: `video${i + 1}` },
						thumbnails: { default: { url: `https://example.com/thumb${i + 1}.jpg` } },
						videoOwnerChannelTitle: 'Test Channel',
					},
				})),
				{
					id: 'deleted-item-1',
					snippet: {
						title: 'Deleted video',
						resourceId: { videoId: '' },
					},
				},
			]

			// Mock YouTube service

			// Mock transaction
			vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
				const tx = {
					track: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'track-new',
							title: 'New Video',
							externalId: 'video-new',
						}),
					},
					artist: {
						findMany: vi.fn().mockResolvedValue([]),
						findFirst: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({
							id: 'artist1',
							name: 'Test Channel',
						}),
					},
					servicePlaylistTrack: {
						findUnique: vi.fn().mockResolvedValue(null),
						upsert: vi.fn().mockResolvedValue({
							id: 'pt-new',
							playlistId,
							trackId: 'track-new',
							position: 1,
							isDeleted: false,
						}),
						findMany: vi.fn().mockResolvedValue([]),
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
			// Should count only the 5 successfully processed tracks, not the deleted video
			expect(result.tracksAdded).toBe(5)
			// Should have pending matches for the deleted video
			expect(result.pendingMatches).toHaveLength(1)
		})
	})
})

