import { describe, expect, test, vi, afterEach } from 'vitest'
import { defineOfflineClientLoader } from './define-offline-client-loader.ts'

describe('defineOfflineClientLoader', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test('defers createOfflineClientLoader until clientLoader runs', async () => {
		vi.stubGlobal('navigator', { onLine: true })
		const clientLoader = defineOfflineClientLoader<{ online: true }, { offline: true }>(
			'routes/_marketing+/index',
		)
		const serverLoader = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

		const result = await clientLoader({
			serverLoader,
			params: {},
			request: new Request('https://example.com/'),
		})

		expect(result).toEqual({ mode: 'offline' })
		expect(clientLoader.hydrate).toBe(true)
	})
})
