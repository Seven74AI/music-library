import { describe, expect, test, vi, beforeEach } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.ts'
import { createUserPlaylist } from '#app/utils/user-playlist.server.ts'
import { action } from './playlists.new.tsx'

vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

vi.mock('#app/utils/user-playlist.server.ts', () => ({
	createUserPlaylist: vi.fn(),
}))

vi.mock('#app/utils/toast.server.ts', () => ({
	createToastHeaders: vi.fn().mockResolvedValue({}),
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
	})

	test('redirects to playlist detail when create succeeds', async () => {
		vi.mocked(createUserPlaylist).mockResolvedValue({
			status: 'success',
			playlist: {
				id: 'playlist-1',
				title: 'Road Trip',
				description: null,
				_count: { tracks: 0 },
			},
		})

		const formData = new FormData()
		formData.append('title', 'Road Trip')
		formData.append('description', 'Summer vibes')

		const response = (await action({
			request: makeRequest(formData),
		} as never)) as Response

		expect(createUserPlaylist).toHaveBeenCalledWith({
			userId: 'user-1',
			title: 'Road Trip',
			description: 'Summer vibes',
		})
		expect(response.headers.get('Location')).toBe('/playlists/playlist-1')
	})

	test('returns duplicate title error', async () => {
		vi.mocked(createUserPlaylist).mockResolvedValue({
			status: 'duplicate_title',
			existingTitle: 'Road Trip',
		})

		const formData = new FormData()
		formData.append('title', 'road trip')
		formData.append('description', '')

		const response = await action({
			request: makeRequest(formData),
		} as never)

		expect(response).toMatchObject({
			init: { status: 409 },
			data: {
				error: 'You already have a playlist named "Road Trip"',
			},
		})
	})
})
