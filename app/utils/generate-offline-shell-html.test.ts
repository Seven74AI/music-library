import { describe, expect, test } from 'vitest'
import {
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

describe('generateOfflineShellHtml', () => {
	test('bootstraps ENV from localStorage and loads the client entry', () => {
		const html = generateOfflineShellHtml({
			manifestScript: '/assets/manifest-8c19c2c9.js',
			entryClient: '/assets/entry.client-DfG4YbEa.js',
			stylesheet: '/assets/tailwind-BHgWvkYH.css',
			sprite: '/assets/sprite-CNCgLjV5.svg',
		})

		expect(html).toContain('data-offline-shell="true"')
		expect(html).toContain("localStorage.getItem('music-library:offline-root-shell')")
		expect(html).toContain('window.__reactRouterContext')
		expect(html).toContain('controller.close()')
		expect(html).toContain('/assets/manifest-8c19c2c9.js')
		expect(html).toContain('import("/assets/entry.client-DfG4YbEa.js")')
	})
})
