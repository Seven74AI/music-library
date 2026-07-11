import { describe, expect, test, vi, beforeEach } from 'vitest'
import {
	findAllServicePlaylistTracks,
	SERVICE_PLAYLIST_TRACK_PAGE_SIZE,
} from './service-playlist-track-queries.server'

describe('findAllServicePlaylistTracks', () => {
	const findMany = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('returns a single page when results fit in one query', async () => {
		findMany.mockResolvedValueOnce([
			{ id: 'pt-1', position: 1 },
			{ id: 'pt-2', position: 2 },
		])

		const client = { servicePlaylistTrack: { findMany } }
		const results = await findAllServicePlaylistTracks(client, {
			where: { playlistId: 'playlist-1' },
		})

		expect(results).toHaveLength(2)
		expect(findMany).toHaveBeenCalledTimes(1)
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { playlistId: 'playlist-1' },
				take: SERVICE_PLAYLIST_TRACK_PAGE_SIZE,
				skip: 0,
				orderBy: { id: 'asc' },
			}),
		)
	})

	test('paginates until a partial page is returned', async () => {
		const firstPage = Array.from({ length: SERVICE_PLAYLIST_TRACK_PAGE_SIZE }, (_, i) => ({
			id: `pt-${i}`,
			position: i + 1,
		}))
		const secondPage = [{ id: 'pt-last', position: SERVICE_PLAYLIST_TRACK_PAGE_SIZE + 1 }]

		findMany
			.mockResolvedValueOnce(firstPage)
			.mockResolvedValueOnce(secondPage)

		const client = { servicePlaylistTrack: { findMany } }
		const results = await findAllServicePlaylistTracks(client, {
			where: { playlistId: 'playlist-1' },
			include: { track: true },
		})

		expect(results).toHaveLength(SERVICE_PLAYLIST_TRACK_PAGE_SIZE + 1)
		expect(findMany).toHaveBeenCalledTimes(2)
		expect(findMany.mock.calls[1]?.[0]).toMatchObject({
			skip: SERVICE_PLAYLIST_TRACK_PAGE_SIZE,
		})
	})
})
