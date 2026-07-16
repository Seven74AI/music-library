import 'dotenv/config'
import '../../server/local-storage-polyfill.ts'
import './db-setup.ts'
import '#app/utils/env.server.ts'
// we need these to be imported first 👆

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'
import { server } from '#tests/mocks/index.ts'
import './custom-matchers.ts'

// ResizeObserver is not available in JSDOM — stub globally for all tests
function MockResizeObserver(_callback: () => void) {
	// no-op
}
MockResizeObserver.prototype.observe = vi.fn()
MockResizeObserver.prototype.unobserve = vi.fn()
MockResizeObserver.prototype.disconnect = vi.fn()
vi.stubGlobal('ResizeObserver', MockResizeObserver)

afterEach(() => server.resetHandlers())
afterEach(() => cleanup())

export let consoleError: MockInstance<(typeof console)['error']>
export let consoleWarn: MockInstance<(typeof console)['warn']>

beforeEach(() => {
	const originalConsoleError = console.error
	consoleError = vi.spyOn(console, 'error')
	consoleError.mockImplementation(
		(...args: Parameters<typeof console.error>) => {
			originalConsoleError(...args)
			throw new Error(
				'Console error was called. Call consoleError.mockImplementation(() => {}) if this is expected.',
			)
		},
	)

	const originalConsoleWarn = console.warn
	consoleWarn = vi.spyOn(console, 'warn')
	consoleWarn.mockImplementation((...args: Parameters<typeof console.warn>) => {
		originalConsoleWarn(...args)
		throw new Error(
			'Console warn was called. Call consoleWarn.mockImplementation(() => {}) if this is expected.',
		)
	})
})
