import { describe, expect, test, vi, beforeEach } from 'vitest'
import {
	fetchPlaybackTracks,
	parsePlaybackIds,
} from '#app/features/queue/queue-playback.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { loader } from './playback.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/features/queue/queue-playback.server.ts', () => ({
	parsePlaybackIds: vi.fn(),
	fetchPlaybackTracks: vi.fn(),
	PLAYBACK_TRACK_SELECT: {},
}))

function makeRequest(url: string) {
	return { request: new Request(url), url: new URL(url) }
}

describe('tracks playback API loader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
	})

	test('returns 400 when ids are missing', async () => {
		vi.mocked(parsePlaybackIds).mockReturnValue({
			ok: false,
			error: 'Track IDs are required',
		})

		const response = await loader({
			...makeRequest('http://localhost/api/tracks/playback'),
		} as never)

		expect(response.status).toBe(400)
		expect(fetchPlaybackTracks).not.toHaveBeenCalled()
	})

	test('returns 400 when too many ids are requested', async () => {
		vi.mocked(parsePlaybackIds).mockReturnValue({
			ok: false,
			error: 'Too many track IDs',
		})

		const response = await loader({
			...makeRequest(
				'http://localhost/api/tracks/playback?ids=' +
					Array.from({ length: 21 }, (_, i) => `id-${i}`).join(','),
			),
		} as never)

		expect(response.status).toBe(400)
		const body = (await response.json()) as { error: string }
		expect(body.error).toBe('Too many track IDs')
	})

	test('redirects to login when unauthenticated', async () => {
		vi.mocked(requireUserId).mockRejectedValue(
			new Response(null, { status: 302 }),
		)

		await expect(
			loader({
				...makeRequest(
					'http://localhost/api/tracks/playback?ids=track-1,track-2',
				),
			} as never),
		).rejects.toSatisfy(
			(err: unknown) => err instanceof Response && err.status === 302,
		)
	})

	test('returns hydrated playback tracks', async () => {
		vi.mocked(parsePlaybackIds).mockReturnValue({
			ok: true,
			value: ['track-1', 'track-2'],
		})
		vi.mocked(fetchPlaybackTracks).mockResolvedValue({
			tracks: [
				{
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
				},
			],
		})

		const response = await loader({
			...makeRequest(
				'http://localhost/api/tracks/playback?ids=track-1,track-2',
			),
		} as never)

		expect(response.status).toBe(200)
		expect(fetchPlaybackTracks).toHaveBeenCalledWith('user-1', [
			'track-1',
			'track-2',
		])
		const body = (await response.json()) as {
			tracks: Array<Record<string, unknown>>
		}
		expect(body.tracks[0]).toMatchObject({
			id: 'track-1',
			audioFiles: expect.any(Array),
			coverImage: expect.any(Object),
			duration: 180,
		})
	})
})
