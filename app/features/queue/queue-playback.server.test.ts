import { describe, expect, test, vi, beforeEach } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import {
	fetchPlaybackTracks,
	parsePlaybackIds,
	PLAYBACK_TRACK_SELECT,
} from './queue-playback.server.ts'

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		track: {
			findMany: vi.fn(),
		},
	},
}))

describe('parsePlaybackIds', () => {
	test('parses comma-separated ids', () => {
		expect(parsePlaybackIds('a,b,c')).toEqual({
			ok: true,
			value: ['a', 'b', 'c'],
		})
	})

	test('trims whitespace around ids', () => {
		expect(parsePlaybackIds(' a , b ')).toEqual({
			ok: true,
			value: ['a', 'b'],
		})
	})

	test('rejects missing ids', () => {
		expect(parsePlaybackIds(null)).toEqual({
			ok: false,
			error: 'Track IDs are required',
		})
	})

	test('rejects empty ids string', () => {
		expect(parsePlaybackIds('')).toEqual({
			ok: false,
			error: 'Track IDs are required',
		})
	})

	test('rejects more than PLAYBACK_BATCH_MAX_IDS ids', () => {
		const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`).join(',')
		expect(parsePlaybackIds(ids)).toEqual({
			ok: false,
			error: 'Too many track IDs',
		})
	})
})

describe('fetchPlaybackTracks', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('returns accessible tracks with full playback projection', async () => {
		const playbackTrack = {
			id: 'track-1',
			title: 'Song One',
			duration: 180,
			artist: { id: 'artist-1', name: 'Artist One' },
			coverImage: { objectKey: 'images/tracks/track-1/cover/hash.jpg' },
			audioFiles: [
				{
					id: 'audio-1',
					format: 'mp3',
					objectKey: 'audio/tracks/youtube/track-1.mp3',
				},
			],
		}
		vi.mocked(prisma.track.findMany).mockResolvedValue([playbackTrack] as never)

		const result = await fetchPlaybackTracks('user-1', ['track-1'])

		expect(prisma.track.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: { in: ['track-1'] },
					OR: [
						{
							userTracks: {
								some: {
									userId: 'user-1',
									isActive: true,
									deletedAt: null,
								},
							},
						},
						{
							servicePlaylistTracks: {
								some: {
									playlist: {
										ownerId: 'user-1',
										isActive: true,
									},
								},
							},
						},
						{
							playlists: {
								some: {
									playlist: {
										ownerId: 'user-1',
									},
								},
							},
						},
					],
				},
				select: PLAYBACK_TRACK_SELECT,
			}),
		)
		expect(result).toEqual({ tracks: [playbackTrack] })
	})

	test('preserves requested track order', async () => {
		const trackA = {
			id: 'track-a',
			title: 'A',
			duration: 100,
			artist: { id: 'artist-a', name: 'Artist A' },
			coverImage: null,
			audioFiles: [],
		}
		const trackB = {
			id: 'track-b',
			title: 'B',
			duration: 200,
			artist: { id: 'artist-b', name: 'Artist B' },
			coverImage: null,
			audioFiles: [],
		}
		vi.mocked(prisma.track.findMany).mockResolvedValue([trackB, trackA] as never)

		const result = await fetchPlaybackTracks('user-1', ['track-a', 'track-b'])

		expect(result.tracks.map(track => track.id)).toEqual(['track-a', 'track-b'])
	})

	test('returns empty tracks when none are accessible', async () => {
		vi.mocked(prisma.track.findMany).mockResolvedValue([])

		const result = await fetchPlaybackTracks('user-1', ['track-1'])

		expect(result).toEqual({ tracks: [] })
	})
})
