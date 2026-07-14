import { describe, expect, test } from 'vitest'
import {
	resolveOfflineStubForRoute,
	shouldSkipOfflineMiddlewareRoute,
} from '#app/features/offline-app/offline-route-policies.client.ts'
import {
	patchOfflineDataStrategyResults,
	shouldSubstituteOfflineResult,
} from './offline-client.middleware.client.ts'

describe('shouldSkipOfflineMiddlewareRoute', () => {
	test('skips live routes and auth routes', () => {
		expect(shouldSkipOfflineMiddlewareRoute('routes/library.index')).toBe(true)
		expect(shouldSkipOfflineMiddlewareRoute('routes/_auth+/login')).toBe(true)
		expect(shouldSkipOfflineMiddlewareRoute('routes/search')).toBe(false)
	})
})

describe('resolveOfflineStubForRoute', () => {
	test('returns shaped search fallback', () => {
		const fallback = resolveOfflineStubForRoute(
			'routes/search',
			new Request('https://example.com/search?q=foo'),
		)
		expect(fallback).toMatchObject({ results: [], query: '' })
	})

	test('extracts track id from pathname', () => {
		const fallback = resolveOfflineStubForRoute(
			'routes/library.$trackId',
			new Request('https://example.com/library/track-123'),
		) as { track: { id: string } }
		expect(fallback.track.id).toBe('track-123')
	})
})

describe('shouldSubstituteOfflineResult', () => {
	test('substitutes loader errors while offline', () => {
		expect(
			shouldSubstituteOfflineResult({
				type: 'error',
				result: new Error('Unauthorized'),
			}),
		).toBe(true)
	})

	test('substitutes missing loader results', () => {
		expect(shouldSubstituteOfflineResult(undefined)).toBe(true)
	})

	test('keeps successful data', () => {
		expect(
			shouldSubstituteOfflineResult({
				type: 'data',
				result: { ok: true },
			}),
		).toBe(false)
	})
})

describe('patchOfflineDataStrategyResults', () => {
	test('patches failed loader results for stub routes', () => {
		const request = new Request('https://example.com/search')
		const patched = patchOfflineDataStrategyResults(
			{
				root: { type: 'data', result: { user: null } },
				'routes/search': {
					type: 'error',
					result: new TypeError('Failed to fetch'),
				},
			},
			request,
		)

		expect(patched.root).toEqual({ type: 'data', result: { user: null } })
		expect(patched['routes/search']).toMatchObject({
			type: 'data',
			result: { results: [], query: '' },
		})
	})
})
