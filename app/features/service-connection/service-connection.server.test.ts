import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YOUTUBE_SERVICE } from '#app/constants/services'

const mockRefreshAccessToken = vi.fn()

vi.mock('#app/utils/db.server', () => ({
	prisma: {
		connection: {
			findFirst: vi.fn(),
			update: vi.fn(),
			deleteMany: vi.fn(),
		},
	},
}))

vi.mock('#app/utils/youtube-oauth.server', () => ({
	createYouTubeOAuthService: vi.fn(() => ({
		refreshAccessToken: mockRefreshAccessToken,
	})),
}))

vi.mock('#app/utils/youtube-mock-utils', () => ({
	shouldMockYouTube: vi.fn(() => false),
}))

describe('resolveServiceAccessToken', () => {
	beforeEach(async () => {
		vi.clearAllMocks()
		const { shouldMockYouTube } = await import('#app/utils/youtube-mock-utils')
		vi.mocked(shouldMockYouTube).mockReturnValue(false)
	})

	it('returns null when no connection exists', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue(null)

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toBeNull()
	})

	it('returns null when connection has no tokens', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		})

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toBeNull()
	})

	it('returns access_token for a valid non-expired token', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: JSON.stringify({
				access_token: 'valid-token',
				expiry_date: Date.now() + 3600_000,
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		})

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toEqual({ access_token: 'valid-token' })
		expect(mockRefreshAccessToken).not.toHaveBeenCalled()
	})

	it('refreshes expired tokens when a refresh token is available', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: JSON.stringify({
				access_token: 'expired-token',
				refresh_token: 'refresh-token',
				expiry_date: Date.now() - 1000,
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		mockRefreshAccessToken.mockResolvedValue({
			access_token: 'refreshed-token',
			expiry_date: Date.now() + 3600_000,
		})
		vi.mocked(prisma.connection.update).mockResolvedValue({} as never)

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toEqual({ access_token: 'refreshed-token' })
		expect(mockRefreshAccessToken).toHaveBeenCalledWith('refresh-token')
		expect(prisma.connection.update).toHaveBeenCalledWith({
			where: { id: 'conn-1' },
			data: {
				tokens: expect.stringContaining('refreshed-token'),
			},
		})
	})

	it('returns null when token is expired and no refresh token exists', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: JSON.stringify({
				access_token: 'expired-token',
				expiry_date: Date.now() - 1000,
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		})

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toBeNull()
		expect(mockRefreshAccessToken).not.toHaveBeenCalled()
	})

	it('returns null when token refresh fails', async () => {
		const { consoleError } = await import('#tests/setup/setup-test-env.ts')
		consoleError.mockImplementation(() => {})

		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: JSON.stringify({
				access_token: 'expired-token',
				refresh_token: 'refresh-token',
				expiry_date: Date.now() - 1000,
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		mockRefreshAccessToken.mockRejectedValue(new Error('OAuth refresh failed'))

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toBeNull()
	})

	it('returns mock token without refresh when YouTube mocks are enabled', async () => {
		const { shouldMockYouTube } = await import('#app/utils/youtube-mock-utils')
		vi.mocked(shouldMockYouTube).mockReturnValue(true)

		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: JSON.stringify({
				access_token: 'mock-access-token',
				expiry_date: Date.now() - 1000,
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		})

		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toEqual({ access_token: 'mock-access-token' })
		expect(mockRefreshAccessToken).not.toHaveBeenCalled()
	})

	it('returns null for unsupported services', async () => {
		const { resolveServiceAccessToken } = await import('./service-connection.server.ts')

		const result = await resolveServiceAccessToken('spotify', 'user-1')

		expect(result).toBeNull()
	})
})

describe('hasServiceConnection', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns true when resolveServiceAccessToken succeeds', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue({
			id: 'conn-1',
			providerName: YOUTUBE_SERVICE.NAME,
			providerId: 'yt-1',
			userId: 'user-1',
			tokens: JSON.stringify({
				access_token: 'valid-token',
				expiry_date: Date.now() + 3600_000,
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		})

		const { hasServiceConnection } = await import('./service-connection.server.ts')

		expect(await hasServiceConnection(YOUTUBE_SERVICE.NAME, 'user-1')).toBe(true)
	})

	it('returns false when resolveServiceAccessToken returns null', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.findFirst).mockResolvedValue(null)

		const { hasServiceConnection } = await import('./service-connection.server.ts')

		expect(await hasServiceConnection(YOUTUBE_SERVICE.NAME, 'user-1')).toBe(false)
	})
})

describe('disconnectServiceConnection', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns true when a connection is deleted', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.deleteMany).mockResolvedValue({ count: 1 })

		const { disconnectServiceConnection } = await import('./service-connection.server.ts')

		const result = await disconnectServiceConnection(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toBe(true)
		expect(prisma.connection.deleteMany).toHaveBeenCalledWith({
			where: {
				providerName: YOUTUBE_SERVICE.NAME,
				userId: 'user-1',
			},
		})
	})

	it('returns false when no connection existed', async () => {
		const { prisma } = await import('#app/utils/db.server')
		vi.mocked(prisma.connection.deleteMany).mockResolvedValue({ count: 0 })

		const { disconnectServiceConnection } = await import('./service-connection.server.ts')

		const result = await disconnectServiceConnection(YOUTUBE_SERVICE.NAME, 'user-1')

		expect(result).toBe(false)
	})
})
