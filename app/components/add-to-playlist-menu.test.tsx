/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { AddToPlaylistMenu } from './add-to-playlist-menu'

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
			{
				path: '/playlists/new',
				element: <div>New playlist form</div>,
			},
		],
		{ initialEntries: ['/'] },
	)

	return render(<RouterProvider router={router} />)
}

test('shows create new playlist link when user has no playlists', () => {
	renderMenu([])

	expect(screen.getByText('No playlists yet')).toBeDefined()
	const createLink = screen.getByRole('link', { name: 'Create new playlist' })
	expect(createLink.getAttribute('href')).toBe('/playlists/new?trackId=track-1')
})

test('shows create new playlist link alongside existing playlists', () => {
	renderMenu([
		{
			id: 'playlist-1',
			title: 'Favorites',
			description: null,
			_count: { tracks: 3 },
		},
	])

	expect(screen.getByText('Favorites')).toBeDefined()
	expect(screen.getByRole('link', { name: 'Create new playlist' })).toBeDefined()
})
