/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { ConvertPlaylistDialog } from './convert-playlist-dialog'

const mockConvertSubmit = vi.fn()

const mockConvertFetcher = {
	state: 'idle' as const,
	data: undefined as
		| { status: string; message?: string; existingTitle?: string }
		| undefined,
	submit: mockConvertSubmit,
}

const mockPlaylistsFetcher = {
	state: 'idle' as const,
	data: undefined as
		| {
				playlists: Array<{
					id: string
					title: string
					description: string | null
					_count: { tracks: number }
				}>
		  }
		| undefined,
	load: vi.fn(),
}

let fetcherIndex = 0

vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react-router')>()
	return {
		...actual,
		useFetcher: () => {
			const idx = fetcherIndex % 2
			fetcherIndex += 1
			if (idx === 0) return mockConvertFetcher
			return mockPlaylistsFetcher
		},
	}
})

beforeEach(() => {
	consoleError.mockImplementation(() => {})
	fetcherIndex = 0
	mockConvertFetcher.state = 'idle'
	mockConvertFetcher.data = undefined
	mockPlaylistsFetcher.state = 'idle'
	mockPlaylistsFetcher.data = undefined
	mockPlaylistsFetcher.load.mockReset()
	mockConvertSubmit.mockReset()
})

function renderDialog() {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: (
					<ConvertPlaylistDialog
						playlistId="sp-1"
						playlistTitle="Chill Vibes"
					/>
				),
			},
		],
		{ initialEntries: ['/'] },
	)

	return render(<RouterProvider router={router} />)
}

test('renders overflow button with accessible label', () => {
	renderDialog()
	const button = screen.getByRole('button', {
		name: 'More actions for Chill Vibes',
	})
	expect(button).toBeDefined()
})

test('opens menu with create and add options', async () => {
	const user = userEvent.setup()
	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)

	expect(screen.getByText('Convert to user playlist')).toBeDefined()
	expect(screen.getByText('Create New Playlist')).toBeDefined()
	expect(screen.getByText('Add to Existing Playlist')).toBeDefined()
})

test('create mode shows pre-filled title', async () => {
	const user = userEvent.setup()
	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Create New Playlist'))

	const input = screen.getByPlaceholderText('Playlist name')
	expect(input).toBeDefined()
	expect(input).toHaveValue('Chill Vibes')
})

test('create mode back button returns to menu', async () => {
	const user = userEvent.setup()
	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Create New Playlist'))
	await user.click(screen.getByText('Back'))

	expect(screen.getByText('Convert to user playlist')).toBeDefined()
})

test('add mode shows loading state and back button', async () => {
	const user = userEvent.setup()
	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Add to Existing Playlist'))

	expect(screen.getByPlaceholderText('Search playlists...')).toBeDefined()
	expect(screen.getByText('Back')).toBeDefined()
	expect(mockPlaylistsFetcher.load).toHaveBeenCalledWith('/resources/playlists')
})

test('add mode shows playlists when data loads', async () => {
	const user = userEvent.setup()
	mockPlaylistsFetcher.data = {
		playlists: [
			{ id: 'up-1', title: 'My Mix', description: null, _count: { tracks: 12 } },
			{ id: 'up-2', title: 'Favorites', description: 'Best tracks', _count: { tracks: 34 } },
		],
	}

	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Add to Existing Playlist'))

	expect(screen.getByText('My Mix')).toBeDefined()
	expect(screen.getByText('Favorites')).toBeDefined()
})

test('add mode submits on playlist click', async () => {
	const user = userEvent.setup()
	mockPlaylistsFetcher.data = {
		playlists: [
			{ id: 'up-1', title: 'My Mix', description: null, _count: { tracks: 12 } },
		],
	}

	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Add to Existing Playlist'))
	fireEvent.click(screen.getByText('My Mix'))

	expect(mockConvertSubmit).toHaveBeenCalledWith(
		{ playlistId: 'sp-1', action: 'add', targetPlaylistId: 'up-1' },
		{
			method: 'POST',
			action: '/resources/service-playlist-to-user-playlist',
		},
	)
})

test('create mode submits on button click', async () => {
	const user = userEvent.setup()
	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Create New Playlist'))
	await user.click(screen.getByText('Create Playlist'))

	expect(mockConvertSubmit).toHaveBeenCalledWith(
		{ playlistId: 'sp-1', action: 'create', title: 'Chill Vibes' },
		{
			method: 'POST',
			action: '/resources/service-playlist-to-user-playlist',
		},
	)
})

test('shows error when title is empty in create mode', async () => {
	const user = userEvent.setup()
	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Create New Playlist'))

	const input = screen.getByPlaceholderText('Playlist name')
	await user.clear(input)
	await user.click(screen.getByText('Create Playlist'))

	expect(screen.getByText('Playlist name is required')).toBeDefined()
	expect(mockConvertSubmit).not.toHaveBeenCalled()
})

test('closes dialog on successful convert', async () => {
	const user = userEvent.setup()

	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Create New Playlist'))

	mockConvertFetcher.state = 'idle'
	mockConvertFetcher.data = { status: 'success', message: 'Created' }

	await user.click(screen.getByText('Create Playlist'))
})

test('shows duplicate title error in create mode', async () => {
	const user = userEvent.setup()
	mockConvertFetcher.data = {
		status: 'duplicate_title',
		message: 'You already have a playlist named "Chill Vibes"',
		existingTitle: 'Chill Vibes',
	}

	renderDialog()

	await user.click(
		screen.getByRole('button', { name: 'More actions for Chill Vibes' }),
	)
	await user.click(screen.getByText('Create New Playlist'))

	expect(
		screen.getByText('You already have a playlist named "Chill Vibes"'),
	).toBeDefined()
})
