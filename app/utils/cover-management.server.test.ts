import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import { server } from '#tests/mocks'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'
import {
	downloadExternalImage,
	isRetriableImageDownloadError,
} from './cover-management.server'

describe('isRetriableImageDownloadError', () => {
	test('treats timeouts and network failures as retriable', () => {
		expect(isRetriableImageDownloadError(new Error('The operation was aborted due to timeout'))).toBe(true)
		expect(isRetriableImageDownloadError(new Error('fetch failed'))).toBe(true)
		expect(isRetriableImageDownloadError(new Error('ECONNRESET'))).toBe(true)
	})

	test('does not treat validation errors as retriable', () => {
		expect(isRetriableImageDownloadError(new Error('Invalid content type'))).toBe(false)
		expect(isRetriableImageDownloadError('not an error')).toBe(false)
	})
})

describe('downloadExternalImage', () => {
	test('returns image buffer on success', async () => {
		server.use(
			http.get('https://example.com/cover.jpg', () =>
				HttpResponse.arrayBuffer(Uint8Array.from([1, 2, 3]).buffer, {
					headers: { 'content-type': 'image/jpeg' },
				}),
			),
		)

		await expect(downloadExternalImage('https://example.com/cover.jpg')).resolves.toEqual(
			Buffer.from([1, 2, 3]),
		)
	})

	test('retries transient failures and succeeds on a later attempt', async () => {
		consoleWarn.mockImplementation(() => {})
		let attempts = 0

		server.use(
			http.get('https://example.com/retry.jpg', () => {
				attempts++
				if (attempts === 1) {
					return HttpResponse.error()
				}
				return HttpResponse.arrayBuffer(Uint8Array.from([9]).buffer, {
					headers: { 'content-type': 'image/jpeg' },
				})
			}),
		)

		await expect(downloadExternalImage('https://example.com/retry.jpg')).resolves.toEqual(
			Buffer.from([9]),
		)
		expect(attempts).toBe(2)
	})

	test('returns null after exhausting retries', async () => {
		consoleWarn.mockImplementation(() => {})

		server.use(
			http.get('https://example.com/fail.jpg', () => HttpResponse.error()),
		)

		await expect(downloadExternalImage('https://example.com/fail.jpg')).resolves.toBeNull()
	})

	test('does not retry permanent HTTP failures', async () => {
		consoleWarn.mockImplementation(() => {})
		let attempts = 0

		server.use(
			http.get('https://example.com/missing.jpg', () => {
				attempts++
				return new HttpResponse(null, { status: 404, statusText: 'Not Found' })
			}),
		)

		await expect(downloadExternalImage('https://example.com/missing.jpg')).resolves.toBeNull()
		expect(attempts).toBe(1)
	})
})
