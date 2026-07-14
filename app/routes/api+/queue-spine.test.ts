import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	fetchQueueSpine,
	parseQueueSpineParams,
} from '#app/features/queue/queue-spine.server.ts'
import { loader } from './queue-spine.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/features/queue/queue-spine.server.ts', () => ({
	parseQueueSpineParams: vi.fn(),
	fetchQueueSpine: vi.fn(),
	QUEUE_TRACK_SELECT: {},
}))

function makeRequest(url: string) {
	return { request: new Request(url), url: new URL(url) }
}

describe('queue-spine API loader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
	})

	test('returns 400 for invalid params', async () => {
		vi.mocked(parseQueueSpineParams).mockReturnValue({
			ok: false,
			error: 'Invalid context parameter',
		})

		const response = await loader({
			...makeRequest('http://localhost/api/queue-spine'),
		} as never)

		expect(response.status).toBe(400)
		expect(fetchQueueSpine).not.toHaveBeenCalled()
		const body = (await response.json()) as { error: string }
		expect(body.error).toBe('Invalid context parameter')
	})

	test('returns library spine', async () => {
		vi.mocked(parseQueueSpineParams).mockReturnValue({
			ok: true,
			value: { context: 'library', hasAudioOnly: true },
		})
		vi.mocked(fetchQueueSpine).mockResolvedValue({
			tracks: [
				{
					id: 'track-1',
					title: 'Song One',
					artist: { id: 'artist-1', name: 'Artist One' },
				},
			],
			total: 1,
		})

		const response = await loader({
			...makeRequest(
				'http://localhost/api/queue-spine?context=library&hasAudio=1',
			),
		} as never)

		expect(response.status).toBe(200)
		expect(fetchQueueSpine).toHaveBeenCalledWith('user-1', {
			context: 'library',
			hasAudioOnly: true,
		})
		const body = (await response.json()) as {
			tracks: Array<Record<string, unknown>>
			total: number
		}
		expect(body).toEqual({
			tracks: [
				{
					id: 'track-1',
					title: 'Song One',
					artist: { id: 'artist-1', name: 'Artist One' },
				},
			],
			total: 1,
		})
		expect(body.tracks[0]).not.toHaveProperty('audioFiles')
	})

	test('returns empty library spine', async () => {
		vi.mocked(parseQueueSpineParams).mockReturnValue({
			ok: true,
			value: { context: 'library', hasAudioOnly: true },
		})
		vi.mocked(fetchQueueSpine).mockResolvedValue({
			tracks: [],
			total: 0,
		})

		const response = await loader({
			...makeRequest(
				'http://localhost/api/queue-spine?context=library&hasAudio=1',
			),
		} as never)

		expect(response.status).toBe(200)
		const body = (await response.json()) as { tracks: unknown[]; total: number }
		expect(body).toEqual({ tracks: [], total: 0 })
	})

	test('redirects to login when unauthenticated', async () => {
		vi.mocked(requireUserId).mockRejectedValue(
			new Response(null, { status: 302 }),
		)

		await expect(
			loader({
				...makeRequest(
					'http://localhost/api/queue-spine?context=library&hasAudio=1',
				),
			} as never),
		).rejects.toSatisfy(
			(err: unknown) => err instanceof Response && err.status === 302,
		)
	})

	test('returns playlist spine', async () => {
		vi.mocked(parseQueueSpineParams).mockReturnValue({
			ok: true,
			value: { context: 'playlist', playlistId: 'pl-1' },
		})
		vi.mocked(fetchQueueSpine).mockResolvedValue({
			tracks: [
				{
					id: 'track-2',
					title: 'Song Two',
					artist: { id: 'artist-2', name: 'Artist Two' },
				},
			],
			total: 1,
		})

		const response = await loader({
			...makeRequest(
				'http://localhost/api/queue-spine?context=playlist&playlistId=pl-1',
			),
		} as never)

		expect(response.status).toBe(200)
		expect(fetchQueueSpine).toHaveBeenCalledWith('user-1', {
			context: 'playlist',
			playlistId: 'pl-1',
		})
		const body = (await response.json()) as {
			tracks: Array<Record<string, unknown>>
		}
		expect(body.tracks[0]).not.toHaveProperty('audioFiles')
	})
})
