import { beforeEach, describe, expect, test, vi } from 'vitest'
import { processTrackImagesAsync } from './track-image-processor.server'

vi.mock('#app/utils/db.server', () => ({
	prisma: {
		servicePlaylistTrack: {
			findMany: vi.fn(),
		},
		track: {
			update: vi.fn(),
		},
	},
}))

vi.mock('#app/utils/cover-management.server', () => ({
	downloadExternalImage: vi.fn(),
	findOrCreateCoverImage: vi.fn(),
}))

function makePlaylistTrack(
	id: string,
	trackId: string,
	thumbnailUrl: string,
	coverImageId: string | null = null,
) {
	return {
		id,
		trackId,
		thumbnailUrl,
		track: { id: trackId, coverImageId },
	}
}

describe('processTrackImagesAsync', () => {
	let prisma: Awaited<typeof import('#app/utils/db.server')>['prisma']
	let downloadExternalImage: ReturnType<typeof vi.fn>
	let findOrCreateCoverImage: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		vi.clearAllMocks()
		prisma = (await import('#app/utils/db.server')).prisma
		const coverManagement = await import('#app/utils/cover-management.server')
		downloadExternalImage = vi.mocked(coverManagement.downloadExternalImage)
		findOrCreateCoverImage = vi.mocked(coverManagement.findOrCreateCoverImage)

		downloadExternalImage.mockResolvedValue(Buffer.from('image'))
		findOrCreateCoverImage.mockResolvedValue({ id: 'cover1', objectKey: 'cover1.jpg' })
		vi.mocked(prisma.track.update).mockResolvedValue({} as any)
		vi.mocked(prisma.servicePlaylistTrack.findMany).mockReset()
	})

	test('paginates by playlistId instead of a giant IN clause', async () => {
		const playlistId = 'playlist-large'
		const firstBatch = Array.from({ length: 100 }, (_, i) =>
			makePlaylistTrack(`spt${i}`, `track${i}`, `https://example.com/${i}.jpg`),
		)
		const secondBatch = Array.from({ length: 25 }, (_, i) =>
			makePlaylistTrack(`spt${100 + i}`, `track${100 + i}`, `https://example.com/${100 + i}.jpg`),
		)

		vi.mocked(prisma.servicePlaylistTrack.findMany)
			.mockResolvedValueOnce(firstBatch as any)
			.mockResolvedValueOnce(secondBatch as any)

		await processTrackImagesAsync(playlistId)

		expect(prisma.servicePlaylistTrack.findMany).toHaveBeenCalledTimes(2)

		const firstCall = vi.mocked(prisma.servicePlaylistTrack.findMany).mock.calls[0]?.[0]
		expect(firstCall?.where).toEqual({
			playlistId,
			thumbnailUrl: { not: null },
			track: { coverImageId: null },
		})
		expect(firstCall?.take).toBe(100)
		expect(firstCall?.orderBy).toEqual({ id: 'asc' })
		expect(firstCall?.where).not.toHaveProperty('id')

		const secondCall = vi.mocked(prisma.servicePlaylistTrack.findMany).mock.calls[1]?.[0]
		expect(secondCall?.cursor).toEqual({ id: 'spt99' })
		expect(secondCall?.skip).toBe(1)

		expect(downloadExternalImage).toHaveBeenCalledTimes(125)
		expect(findOrCreateCoverImage).toHaveBeenCalledTimes(125)
		expect(prisma.track.update).toHaveBeenCalledTimes(125)
	})

	test('only processes tracks returned by the playlistId query (no existing covers)', async () => {
		const playlistId = 'playlist-small'
		const tracks = [
			makePlaylistTrack('spt1', 'track1', 'https://example.com/1.jpg'),
			makePlaylistTrack('spt2', 'track2', 'https://example.com/2.jpg'),
		]

		vi.mocked(prisma.servicePlaylistTrack.findMany)
			.mockResolvedValueOnce(tracks as any)
			.mockResolvedValueOnce([])

		await processTrackImagesAsync(playlistId)

		expect(downloadExternalImage).toHaveBeenCalledTimes(2)
		expect(findOrCreateCoverImage).toHaveBeenCalledWith({
			imageBuffer: expect.any(Buffer),
			trackId: 'track1',
		})
		expect(prisma.track.update).toHaveBeenCalledWith({
			where: { id: 'track1' },
			data: { coverImageId: 'cover1' },
		})
	})

	test('does nothing when no tracks need processing', async () => {
		vi.mocked(prisma.servicePlaylistTrack.findMany).mockResolvedValueOnce([])

		await processTrackImagesAsync('playlist-empty')

		expect(downloadExternalImage).not.toHaveBeenCalled()
		expect(findOrCreateCoverImage).not.toHaveBeenCalled()
		expect(prisma.track.update).not.toHaveBeenCalled()
	})
})
