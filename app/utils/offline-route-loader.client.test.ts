import { describe, expect, test, vi, afterEach } from 'vitest'
import { isOfflineEnvironment, loadWithOfflineFallback } from './offline-route-loader.client.ts'

describe('isOfflineEnvironment', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test('returns true when navigator reports offline', () => {
		vi.stubGlobal('navigator', { onLine: false })
		expect(isOfflineEnvironment()).toBe(true)
	})
})

describe('loadWithOfflineFallback', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test('uses offline loader when navigator is offline', async () => {
		vi.stubGlobal('navigator', { onLine: false })
		const serverLoader = vi.fn()
		const offlineLoader = vi.fn().mockResolvedValue({ offline: true })

		const result = await loadWithOfflineFallback(serverLoader, offlineLoader)

		expect(serverLoader).not.toHaveBeenCalled()
		expect(offlineLoader).toHaveBeenCalled()
		expect(result).toEqual({ offline: true })
	})

	test('falls back to offline loader when server loader fails while online', async () => {
		vi.stubGlobal('navigator', { onLine: true })
		const serverLoader = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
		const offlineLoader = vi.fn().mockResolvedValue({ offline: true })

		const result = await loadWithOfflineFallback(serverLoader, offlineLoader)

		expect(serverLoader).toHaveBeenCalled()
		expect(offlineLoader).toHaveBeenCalled()
		expect(result).toEqual({ offline: true })
	})

	test('rethrows non-network server errors while online', async () => {
		vi.stubGlobal('navigator', { onLine: true })
		const serverLoader = vi.fn().mockRejectedValue(new Error('Unauthorized'))
		const offlineLoader = vi.fn()

		await expect(loadWithOfflineFallback(serverLoader, offlineLoader)).rejects.toThrow(
			'Unauthorized',
		)
		expect(offlineLoader).not.toHaveBeenCalled()
	})
})
