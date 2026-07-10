/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { OnboardingHome } from './onboarding-home.tsx'

function renderOnboarding(youtubeConnected: boolean) {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: <OnboardingHome youtubeConnected={youtubeConnected} />,
			},
		],
		{ initialEntries: ['/'] },
	)

	render(<RouterProvider router={router} />)
}

test('shows Connect YouTube when YouTube is not connected', () => {
	renderOnboarding(false)

	const primaryLink = screen.getByRole('link', { name: /connect youtube/i })
	expect(primaryLink).toHaveAttribute('href', '/music/services/youtube/auth')
})

test('shows Sync a playlist when YouTube is connected', () => {
	renderOnboarding(true)

	const primaryLink = screen.getByRole('link', { name: /sync a playlist/i })
	expect(primaryLink).toHaveAttribute('href', '/music/services/youtube/playlists')
})

test('always shows upload as a secondary path', () => {
	renderOnboarding(false)

	const uploadLink = screen.getByRole('link', { name: /upload your files/i })
	expect(uploadLink).toHaveAttribute('href', '/music/services/local/upload')
})
