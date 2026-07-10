import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'
import { action } from './track-library.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/utils/service-playlist.server', () => ({
	createServicePlaylistService: vi.fn(),
}))

vi.mock('#app/utils/toast.server.ts', () => ({
	createToastHeaders: vi.fn().mockResolvedValue({}),
}))

function makeRequest(formData: FormData) {
	return new Request('http://localhost/resources/track-library', {
		method: 'POST',
		body: formData,
	})
}

describe('track-library action', () => {
	const mockAddTrack = vi.fn()
	const mockAddTracks = vi.fn()
	const mockRemoveTrack = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
		vi.mocked(createServicePlaylistService).mockReturnValue({
			addTrackToUserLibrary: mockAddTrack,
			addTracksToUserLibrary: mockAddTracks,
			removeTrackFromUserLibrary: mockRemoveTrack,
		} as unknown as ReturnType<typeof createServicePlaylistService>)
	})

	test('adds a single track via trackId', async () => {
		mockAddTrack.mockResolvedValue({
			success: true,
			message: 'Track added to library',
		})

		const formData = new FormData()
		formData.append('trackId', 'track-1')
		formData.append('action', 'add')

		const response = await action({
			request: makeRequest(formData),
		} as never)

		expect(mockAddTrack).toHaveBeenCalledWith('track-1', 'user-1')
		expect(mockAddTracks).not.toHaveBeenCalled()
		expect(response).toMatchObject({
			data: { status: 'success' },
		})
	})

	test('adds multiple tracks via trackIds in one call', async () => {
		mockAddTracks.mockResolvedValue({
			success: true,
			message: '3 tracks added to library',
			addedCount: 3,
		})

		const formData = new FormData()
		formData.append('action', 'add')
		formData.append('trackIds', 'track-1')
		formData.append('trackIds', 'track-2')
		formData.append('trackIds', 'track-3')

		const response = await action({
			request: makeRequest(formData),
		} as never)

		expect(mockAddTracks).toHaveBeenCalledWith(
			['track-1', 'track-2', 'track-3'],
			'user-1',
		)
		expect(mockAddTrack).not.toHaveBeenCalled()
		expect(response).toMatchObject({
			data: { status: 'success', addedCount: 3 },
		})
	})
})
