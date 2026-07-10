import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { addTrackToUserPlaylist } from '#app/utils/user-playlist.server.ts'
import { action } from './playlists.new.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		userPlaylist: {
			create: vi.fn(),
		},
		track: {
			findUnique: vi.fn(),
		},
	},
}))

vi.mock('#app/utils/user-playlist.server.ts', () => ({
	addTrackToUserPlaylist: vi.fn(),
}))

vi.mock('#app/utils/toast.server.ts', () => ({
	redirectWithToast: vi.fn(),
}))

vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react-router')>()
	return {
		...actual,
		redirect: vi.fn((url: string) => new Response(null, {
			status: 302,
			headers: { Location: url },
		})),
	}
})

function makeRequest(formData: FormData) {
	return new Request('http://localhost/playlists/new', {
		method: 'POST',
		body: formData,
	})
}

describe('playlists.new action', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireUserId).mockResolvedValue('user-1')
		vi.mocked(prisma.userPlaylist.create).mockResolvedValue({
			id: 'playlist-1',
			title: 'Road Trip',
			description: null,
		} as never)
		vi.mocked(redirectWithToast).mockResolvedValue(
			new Response(null, { status: 302, headers: { Location: '/library' } }),
		)
	})

	test('creates playlist and redirects to library when trackId is provided', async () => {
		vi.mocked(prisma.track.findUnique).mockResolvedValue({
			id: 'track-1',
			title: 'Test Song',
		} as never)
		vi.mocked(addTrackToUserPlaylist).mockResolvedValue({
			status: 'success',
			playlistTitle: 'Road Trip',
		})

		const formData = new FormData()
		formData.append('title', 'Road Trip')
		formData.append('description', '')
		formData.append('trackId', 'track-1')

		const response = (await action({
			request: makeRequest(formData),
		} as never)) as Response

		expect(addTrackToUserPlaylist).toHaveBeenCalledWith({
			userId: 'user-1',
			playlistId: 'playlist-1',
			trackId: 'track-1',
		})
		expect(redirectWithToast).toHaveBeenCalledWith('/library', {
			title: 'Success',
			description: 'Created "Road Trip" and added "Test Song"',
			type: 'success',
		})
		expect(response.headers.get('Location')).toBe('/library')
	})

	test('redirects to playlist detail when no trackId is provided', async () => {
		const formData = new FormData()
		formData.append('title', 'Road Trip')
		formData.append('description', 'Summer vibes')

		const response = (await action({
			request: makeRequest(formData),
		} as never)) as Response

		expect(addTrackToUserPlaylist).not.toHaveBeenCalled()
		expect(redirectWithToast).not.toHaveBeenCalled()
		expect(response.headers.get('Location')).toBe('/playlists/playlist-1')
	})
})
