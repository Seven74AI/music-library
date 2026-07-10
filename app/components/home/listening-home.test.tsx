/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { type HomeListeningData } from '#app/utils/home.server.ts'
import { ListeningHome } from './listening-home.tsx'

const playLibrary = vi.fn()

vi.mock('#app/components/audio-player-provider.tsx', () => ({
	useAudioPlayer: () => ({
		playLibrary,
		isLoadingNext: false,
	}),
}))

vi.mock('#app/hooks/use-pwa-install.ts', () => ({
	usePwaInstall: () => ({
		visible: false,
		dismiss: vi.fn(),
		install: vi.fn(),
		isIos: false,
		isAndroid: false,
		canInstallNatively: false,
	}),
}))

vi.mock('#app/components/home/home-recent-track-row.tsx', () => ({
	HomeRecentTrackRow: () => <div>Recent tracks row</div>,
}))

const baseListeningData: HomeListeningData = {
	mode: 'listening',
	totalTracks: 4,
	playableTracks: 2,
	archivingCount: 2,
	stats: {
		totalTracks: 4,
		totalPlaylists: 1,
	},
	recentTracks: [],
	recentPlaylists: [],
	youtubeData: Promise.resolve({
		hasYouTubeConnection: true,
		youtubeStats: {
			totalPlaylists: 1,
			lastSync: new Date('2024-01-01'),
		},
		youtubePlaylists: [],
	}),
}

function renderListening(
	props: Partial<HomeListeningData> & { showArchivingBanner: boolean },
) {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: (
					<Suspense fallback={<div>Loading</div>}>
						<ListeningHome {...baseListeningData} {...props} />
					</Suspense>
				),
			},
		],
		{ initialEntries: ['/'] },
	)

	render(<RouterProvider router={router} />)
}

test('disables Play library in gray mode', async () => {
	renderListening({
		showArchivingBanner: true,
		mode: 'gray',
		playableTracks: 0,
		archivingCount: 3,
	})

	expect(await screen.findByRole('button', { name: /play library/i })).toBeDisabled()
})

test('shows archiving banner in gray mode', async () => {
	renderListening({
		showArchivingBanner: true,
		mode: 'gray',
		totalTracks: 3,
		playableTracks: 0,
		archivingCount: 3,
	})

	const banner = await screen.findByRole('status')
	expect(banner).toHaveTextContent('3 tracks in your library')
	expect(banner).toHaveTextContent('0 ready to play')
	expect(banner).toHaveTextContent('3 archiving')
})

test('enables Play library when tracks are playable', async () => {
	renderListening({ showArchivingBanner: false })

	await waitFor(async () => {
		expect(await screen.findByRole('button', { name: /play library/i })).toBeEnabled()
	})
})
