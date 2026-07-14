import { expect, test } from 'vitest'
import { createCSP } from './csp.server.ts'

test('createCSP generates header with default directives', () => {
	const nonce = 'abc123'
	const result = createCSP(nonce)

	expect(result).toContain("default-src 'none'")
	expect(result).toContain("frame-ancestors 'none'")
	expect(result).toContain("style-src 'self' 'unsafe-inline'")
	expect(result).toContain(
		"img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com",
	)
	expect(result).toContain("connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io")
	expect(result).toContain("font-src 'self'")
	expect(result).toContain("manifest-src 'self'")
	expect(result).toContain(
		"media-src 'self' blob: https://fly.storage.tigris.dev https://*.fly.storage.tigris.dev",
	)
})

test('createCSP includes script-src with self and nonce', () => {
	const nonce = 'def456'
	const result = createCSP(nonce)

	expect(result).toContain("script-src 'self' 'nonce-def456'")
})

test('createCSP handles empty nonce', () => {
	const result = createCSP('')

	expect(result).toContain("default-src 'none'")
	expect(result).toContain("script-src 'self' 'nonce-'")
	expect(result).toContain("frame-ancestors 'none'")
})

test('createCSP handles special characters in nonce', () => {
	const nonce = 'a1b2c3d4e5f6=+/'
	const result = createCSP(nonce)

	expect(result).toContain("script-src 'self' 'nonce-a1b2c3d4e5f6=+/'")
})

test('createCSP allows vite HMR websockets in development', () => {
	const result = createCSP('abc123', { isDev: true })

	expect(result).toContain("connect-src 'self' ws: wss: https://*.ingest.sentry.io https://*.ingest.us.sentry.io")
})

test('createCSP joins directives with semicolon and space', () => {
	const result = createCSP('test')

	expect(result).toBe(
		"default-src 'none'; script-src 'self' 'nonce-test'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com; connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io; font-src 'self'; media-src 'self' blob: https://fly.storage.tigris.dev https://*.fly.storage.tigris.dev; manifest-src 'self'; frame-ancestors 'none'",
	)
})

test('createCSP produces valid CSP string for different nonces', () => {
	const nonces = ['n1', 'n2-longer', '0123456789abcdef']

	for (const n of nonces) {
		const result = createCSP(n)
		expect(result).toContain(`'nonce-${n}'`)
		expect(result).toContain("default-src 'none'")
		expect(result).toContain("style-src 'self' 'unsafe-inline'")
		expect(result).toContain(
			"media-src 'self' blob: https://fly.storage.tigris.dev https://*.fly.storage.tigris.dev",
		)
	}
})
