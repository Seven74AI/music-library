import { describe, expect, it } from 'vitest'
import { isRecoverableArchiveFailure } from './recoverable-failure.ts'

describe('isRecoverableArchiveFailure', () => {
	it('returns false for empty or invalid error history', () => {
		expect(isRecoverableArchiveFailure('')).toBe(false)
		expect(isRecoverableArchiveFailure('[]')).toBe(false)
		expect(isRecoverableArchiveFailure('not json')).toBe(false)
	})

	it('returns true for COOKIE_EXPIRED category', () => {
		const history = JSON.stringify([
			{
				category: 'COOKIE_EXPIRED',
				message: "ERROR: Sign in to confirm you're not a bot",
				timestamp: '2026-07-11T19:00:00.000Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(true)
	})

	it('returns true for FORMAT_UNAVAILABLE category', () => {
		const history = JSON.stringify([
			{
				category: 'FORMAT_UNAVAILABLE',
				message: 'ERROR: Requested format is not available',
				timestamp: '2026-07-11T19:00:00.000Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(true)
	})

	it('returns true for legacy AUTH jobs that failed on format discovery', () => {
		const history = JSON.stringify([
			{
				category: 'AUTH',
				message:
					'ERROR: [youtube] LP8lXGHotpE: Requested format is not available. Use --list-formats for a list of available formats',
				timestamp: '2026-07-11T19:12:27.848Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(true)
	})

	it('returns true for cookie-related messages even when miscategorized', () => {
		const history = JSON.stringify([
			{
				category: 'AUTH',
				message:
					'ERROR: The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser',
				timestamp: '2026-07-11T19:00:00.000Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(true)
	})

	it('returns false for unrelated permanent failures', () => {
		const history = JSON.stringify([
			{
				category: 'GEO_BLOCKED',
				message: 'ERROR: Video unavailable. This video is not available in your country',
				timestamp: '2026-07-11T19:00:00.000Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(false)
	})

	it('returns false for generic AUTH failures', () => {
		const history = JSON.stringify([
			{
				category: 'AUTH',
				message: 'ERROR: Unable to download webpage: HTTP Error 403: Forbidden',
				timestamp: '2026-07-11T19:00:00.000Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(false)
	})

	it('uses only the latest error entry', () => {
		const history = JSON.stringify([
			{
				category: 'FORMAT_UNAVAILABLE',
				message: 'ERROR: Requested format is not available',
				timestamp: '2026-07-11T18:00:00.000Z',
			},
			{
				category: 'GEO_BLOCKED',
				message: 'ERROR: not available in your country',
				timestamp: '2026-07-11T19:00:00.000Z',
			},
		])
		expect(isRecoverableArchiveFailure(history)).toBe(false)
	})
})
