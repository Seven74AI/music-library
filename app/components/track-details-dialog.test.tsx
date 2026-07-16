/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { TrackDetailsDialog } from './track-details-dialog'

const mockLoad = vi.fn()
let fetcherState: 'idle' | 'loading' = 'idle'
let fetcherData: { track: unknown } | undefined = undefined

vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react-router')>()
	return {
		...actual,
		useFetcher: () => ({
			get state() { return fetcherState },
			get data() { return fetcherData },
			load: mockLoad,
			submit: vi.fn(),
		}),
	}
})

beforeEach(() => {
	mockLoad.mockReset()
	fetcherState = 'idle'
	fetcherData = undefined
})

function renderDialog(open = false) {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: (
					<TrackDetailsDialog
						trackId="track-1"
						open={open}
						onOpenChange={vi.fn()}
					/>
				),
			},
		],
		{ initialEntries: ['/'] },
	)

	return render(<RouterProvider router={router} />)
}

test('does not fetch when closed', () => {
	renderDialog(false)
	expect(mockLoad).not.toHaveBeenCalled()
})

test('fetches track details when opened', () => {
	renderDialog(true)
	expect(mockLoad).toHaveBeenCalledWith('/resources/track-details?trackId=track-1')
})

test('shows loading spinner while fetching', () => {
	fetcherState = 'loading'
	renderDialog(true)

	const spinner = document.querySelector('.animate-spin')
	expect(spinner).toBeTruthy()
})

test('shows track details when loaded', () => {
	fetcherData = {
		track: {
			id: 'track-1',
			title: 'Test Song',
			artist: { id: 'artist-1', name: 'Test Artist' },
			duration: 180,
			createdAt: '2025-01-01T00:00:00.000Z',
			coverImage: { objectKey: 'covers/test.jpg' },
			service: { displayName: 'YouTube' },
			serviceUrl: 'https://youtube.com/watch?v=abc',
		},
	}

	renderDialog(true)

	expect(screen.getByText('Test Song')).toBeDefined()
	expect(screen.getByText('Test Artist')).toBeDefined()
	// Duration is formatted
	expect(screen.getByText('Duration: 3:00')).toBeDefined()
	expect(screen.getByText('Source: YouTube')).toBeDefined()
})

test('shows Open on YouTube button when serviceUrl is present', () => {
	fetcherData = {
		track: {
			id: 'track-1',
			title: 'Test',
			artist: { id: 'a', name: 'A' },
			duration: null,
			createdAt: '2025-01-01T00:00:00.000Z',
			coverImage: null,
			service: null,
			serviceUrl: 'https://youtube.com/watch?v=abc',
		},
	}

	renderDialog(true)

	expect(screen.getByText('Open on YouTube')).toBeDefined()
})

test('does not show YouTube button when serviceUrl is null', () => {
	fetcherData = {
		track: {
			id: 'track-1',
			title: 'Test',
			artist: { id: 'a', name: 'A' },
			duration: null,
			createdAt: '2025-01-01T00:00:00.000Z',
			coverImage: null,
			service: null,
			serviceUrl: null,
		},
	}

	renderDialog(true)

	expect(screen.queryByText('Open on YouTube')).toBeNull()
})
