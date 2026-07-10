/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { AddToPlaylistMenu } from './add-to-playlist-menu'

const mockSubmit = vi.fn()
const mockRevalidate = vi.fn()

const mockFetcher = {
	state: 'idle' as const,
	data: undefined as { status: string; message?: string; playlistId?: string } | undefined,
	submit: mockSubmit,
}

const mockCreateFetcher = {
	state: 'idle' as const,
	data: undefined as {
		status: string
		message?: string
		existingTitle?: string
		playlist?: { id: string; title: string; description: string | null; _count: { tracks: number } }
	} | undefined,
	submit: vi.fn(),
}

let useFetcherCallCount = 0

vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react-router')>()
	return {
		...actual,
		useFetcher: () => {
			useFetcherCallCount += 1
			return useFetcherCallCount % 2 === 1 ? mockFetcher : mockCreateFetcher
		},
		useRevalidator: () => ({ revalidate: mockRevalidate }),
	}
})

beforeEach(() => {
	useFetcherCallCount = 0
	mockFetcher.state = 'idle'
	mockFetcher.data = undefined
	mockCreateFetcher.state = 'idle'
	mockCreateFetcher.data = undefined
	mockSubmit.mockReset()
	mockRevalidate.mockReset()
})

function renderMenu(playlists: Array<{ id: string; title: string; description: string | null; _count: { tracks: number } }> = []) {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: (
					<AddToPlaylistMenu
						trackId="track-1"
						trackTitle="Test Song"
						playlists={playlists}
					/>
				),
			},
		],
		{ initialEntries: ['/'] },
	)

	return render(<RouterProvider router={router} />)
}

test('shows new playlist button when user has no playlists', () => {
	renderMenu([])

	expect(screen.getByText('No playlists yet')).toBeDefined()
	expect(screen.getByRole('button', { name: 'New playlist' })).toBeDefined()
})

test('expands inline create form and submits playlist name', async () => {
	const user = userEvent.setup()
	renderMenu([])

	await user.click(screen.getByRole('button', { name: 'New playlist' }))
	const input = screen.getByPlaceholderText('Playlist name')
	await user.type(input, 'Road Trip')
	await user.click(screen.getByRole('button', { name: 'Create playlist' }))

	expect(mockCreateFetcher.submit).toHaveBeenCalled()
})

test('shows new playlist button alongside existing playlists', () => {
	renderMenu([
		{
			id: 'playlist-1',
			title: 'Favorites',
			description: null,
			_count: { tracks: 3 },
		},
	])

	expect(screen.getByText('Favorites')).toBeDefined()
	expect(screen.getByRole('button', { name: 'New playlist' })).toBeDefined()
})

test('shows newly created playlist only once after inline create succeeds', () => {
	mockCreateFetcher.data = {
		status: 'success',
		playlist: {
			id: 'playlist-new',
			title: 'test5',
			description: null,
			_count: { tracks: 1 },
		},
	}

	renderMenu([
		{
			id: 'playlist-1',
			title: 'test4',
			description: null,
			_count: { tracks: 1 },
		},
	])

	expect(screen.getAllByText('test5')).toHaveLength(1)
})
