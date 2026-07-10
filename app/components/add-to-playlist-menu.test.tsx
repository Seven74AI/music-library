/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { AddToPlaylistMenu } from './add-to-playlist-menu'

const mockSubmit = vi.fn()

vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react-router')>()
	return {
		...actual,
		useFetcher: () => ({
			state: 'idle',
			data: undefined,
			submit: mockSubmit,
		}),
		useRevalidator: () => ({ revalidate: vi.fn() }),
	}
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

	expect(mockSubmit).toHaveBeenCalled()
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
