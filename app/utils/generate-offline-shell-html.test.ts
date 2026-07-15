import { describe, expect, test } from 'vitest'
import {
	buildOfflineRouterBootstrap,
	serializeEmptyRouterPayload,
	findOfflineShellAssets,
	generateOfflineShellHtml,
} from './generate-offline-shell-html.ts'

describe('findOfflineShellAssets', () => {
	test('resolves hashed production asset paths', () => {
		const assets = findOfflineShellAssets([
			'manifest-8c19c2c9.js',
			'entry.client-DfG4YbEa.js',
			'tailwind-BHgWvkYH.css',
			'sprite-CNCgLjV5.svg',
		])

		expect(assets).toEqual({
			manifestScript: '/assets/manifest-8c19c2c9.js',
			entryClient: '/assets/entry.client-DfG4YbEa.js',
			stylesheet: '/assets/tailwind-BHgWvkYH.css',
			sprite: '/assets/sprite-CNCgLjV5.svg',
		})
	})

	test('throws when required assets are missing', () => {
		expect(() => findOfflineShellAssets(['tailwind-BHgWvkYH.css'])).toThrow(
			/manifest-.*\.js/,
		)
	})
})

describe('serializeEmptyRouterPayload', () => {
	test('returns a v2-compatible turbo-stream payload (JSON array + newline)', () => {
		const line = serializeEmptyRouterPayload()

		// v2 decoder expects first chunk to be a JSON array
		const parsed = JSON.parse(line.trimEnd())
		expect(Array.isArray(parsed)).toBe(true)
		expect(parsed).toHaveLength(1)
		expect(parsed[0]).toEqual({
			loaderData: {},
			actionData: {},
			errors: {},
		})
		expect(line.endsWith('\n')).toBe(true)
	})
})

describe('buildOfflineRouterBootstrap', () => {
	test('bootstraps route modules and a valid stream handoff', () => {
		const bootstrap = buildOfflineRouterBootstrap(serializeEmptyRouterPayload())

		expect(bootstrap).toContain('window.__reactRouterRouteModules = {}')
		expect(bootstrap).toContain('streamController.enqueue')
		expect(bootstrap).toContain('"isSpaMode":true')
		expect(bootstrap).toContain('streamController.close()')
	})
})

describe('generateOfflineShellHtml', () => {
	test('bootstraps ENV from localStorage and loads the client entry', async () => {
		const html = await generateOfflineShellHtml({
			manifestScript: '/assets/manifest-8c19c2c9.js',
			entryClient: '/assets/entry.client-DfG4YbEa.js',
			stylesheet: '/assets/tailwind-BHgWvkYH.css',
			sprite: '/assets/sprite-CNCgLjV5.svg',
		})

		expect(html).toContain('data-offline-shell="true"')
		expect(html).toContain("localStorage.getItem('music-library:offline-root-shell')")
		expect(html).toContain('window.__reactRouterContext')
		expect(html).toContain('window.__reactRouterRouteModules = {}')
		expect(html).toContain('streamController.enqueue')
		expect(html).toContain('/assets/manifest-8c19c2c9.js')
		expect(html).toContain('import("/assets/entry.client-DfG4YbEa.js")')
	})

	test('includes a visible splash before client JS loads', async () => {
		const html = await generateOfflineShellHtml({
			entryClient: '/assets/entry.client-DfG4YbEa.js',
		})

		expect(html).toContain('id="offline-shell-splash"')
		expect(html).toContain('role="status"')
		expect(html).toContain('Loading…')
		expect(html).toContain("You're offline. Opening saved music")
		expect(html).toContain('navigator.onLine')
	})
})
