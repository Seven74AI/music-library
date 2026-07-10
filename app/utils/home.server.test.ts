import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { hasValidYouTubeOAuth } from '#app/utils/youtube-oauth-validation.server.ts'
import { loadHomeData, resolveHomeMode, type HomeData } from './home.server.ts'

vi.mock('#app/utils/auth.server.ts', () => ({
	getUserId: vi.fn(),
}))

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		user: {
			findFirst: vi.fn(),
		},
		userTrack: {
			count: vi.fn(),
			findMany: vi.fn(),
		},
		userPlaylist: {
			count: vi.fn(),
			findMany: vi.fn(),
		},
		service: {
			findUnique: vi.fn(),
		},
	},
}))

vi.mock('#app/utils/youtube-oauth-validation.server.ts', () => ({
	hasValidYouTubeOAuth: vi.fn(),
}))

vi.mock('#app/utils/service-playlist.server.ts', () => ({
	createServicePlaylistService: vi.fn(() => ({
		getSyncedPlaylists: vi.fn().mockResolvedValue([]),
	})),
}))

function unwrapHomeData(result: Awaited<ReturnType<typeof loadHomeData>>): HomeData {
	return (result as { data: HomeData }).data
}

const mockAdminUser = {
	id: 'user-1',
	email: 'admin@example.com',
	username: 'admin',
	name: 'Admin User',
	createdAt: new Date('2024-01-01'),
	updatedAt: new Date('2024-01-01'),
}

describe('resolveHomeMode', () => {
	test('returns onboarding when there are no library tracks', () => {
		expect(resolveHomeMode(0, 0)).toBe('onboarding')
	})

	test('returns gray when there are tracks but none are playable', () => {
		expect(resolveHomeMode(5, 0)).toBe('gray')
	})

	test('returns listening when there is at least one playable track', () => {
		expect(resolveHomeMode(5, 2)).toBe('listening')
	})
})

describe('loadHomeData', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('returns marketing mode for anonymous users', async () => {
		vi.mocked(getUserId).mockResolvedValue(null)

		const result = unwrapHomeData(await loadHomeData(new Request('http://localhost/')))

		expect(result).toEqual({ mode: 'marketing' })
	})

	test('returns onboarding mode with YouTube status when library is empty', async () => {
		vi.mocked(getUserId).mockResolvedValue('user-1')
		vi.mocked(prisma.userTrack.count).mockResolvedValue(0)
		vi.mocked(hasValidYouTubeOAuth).mockResolvedValue(true)
		vi.mocked(prisma.user.findFirst).mockResolvedValue(mockAdminUser)

		const result = unwrapHomeData(await loadHomeData(new Request('http://localhost/')))

		expect(result).toEqual({
			mode: 'onboarding',
			youtubeConnected: true,
			isAdmin: true,
		})
	})

	test('returns isAdmin false for non-admin users in onboarding mode', async () => {
		vi.mocked(getUserId).mockResolvedValue('user-1')
		vi.mocked(prisma.userTrack.count).mockResolvedValue(0)
		vi.mocked(hasValidYouTubeOAuth).mockResolvedValue(false)
		vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

		const result = unwrapHomeData(await loadHomeData(new Request('http://localhost/')))

		expect(result).toEqual({
			mode: 'onboarding',
			youtubeConnected: false,
			isAdmin: false,
		})
	})

	test('returns gray mode with track counts when nothing is playable yet', async () => {
		vi.mocked(getUserId).mockResolvedValue('user-1')
		vi.mocked(prisma.userTrack.count)
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(0)
		vi.mocked(prisma.userPlaylist.count).mockResolvedValue(1)
		vi.mocked(prisma.userTrack.findMany).mockResolvedValue([])
		vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([])
		vi.mocked(prisma.service.findUnique).mockResolvedValue(null)

		const result = unwrapHomeData(await loadHomeData(new Request('http://localhost/')))

		expect(result).toMatchObject({
			mode: 'gray',
			totalTracks: 3,
			playableTracks: 0,
			archivingCount: 3,
			stats: { totalTracks: 3, totalPlaylists: 1 },
		})
	})

	test('returns listening mode when playable tracks exist', async () => {
		vi.mocked(getUserId).mockResolvedValue('user-1')
		vi.mocked(prisma.userTrack.count)
			.mockResolvedValueOnce(4)
			.mockResolvedValueOnce(2)
		vi.mocked(prisma.userPlaylist.count).mockResolvedValue(2)
		vi.mocked(prisma.userTrack.findMany).mockResolvedValue([])
		vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([])
		vi.mocked(prisma.service.findUnique).mockResolvedValue(null)

		const result = unwrapHomeData(await loadHomeData(new Request('http://localhost/')))

		expect(result).toMatchObject({
			mode: 'listening',
			totalTracks: 4,
			playableTracks: 2,
			archivingCount: 2,
		})
	})
})
