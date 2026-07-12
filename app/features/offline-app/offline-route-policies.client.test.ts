import { describe, expect, test } from 'vitest'
import {
	OFFLINE_ROUTE_POLICIES,
	isLiveOfflineRoute,
	resolveOfflineStubForRoute,
	shouldSkipOfflineMiddlewareRoute,
} from './offline-route-policies.client.ts'

describe('OFFLINE_ROUTE_POLICIES', () => {
	test('registers live routes for cached playback views', () => {
		expect(OFFLINE_ROUTE_POLICIES['routes/library.index']?.mode).toBe('live')
		expect(OFFLINE_ROUTE_POLICIES['routes/downloads']?.mode).toBe('live')
		expect(OFFLINE_ROUTE_POLICIES.root?.mode).toBe('live')
	})

	test('registers stub routes for network-only views', () => {
		expect(OFFLINE_ROUTE_POLICIES['routes/search']?.mode).toBe('stub')
		expect(OFFLINE_ROUTE_POLICIES['routes/admin+/audio-queue']?.mode).toBe('stub')
	})
})

describe('shouldSkipOfflineMiddlewareRoute', () => {
	test('skips live routes and auth routes', () => {
		expect(shouldSkipOfflineMiddlewareRoute('routes/library.index')).toBe(true)
		expect(shouldSkipOfflineMiddlewareRoute('routes/_auth+/login')).toBe(true)
		expect(shouldSkipOfflineMiddlewareRoute('routes/search')).toBe(false)
	})
})

describe('isLiveOfflineRoute', () => {
	test('identifies live offline routes', () => {
		expect(isLiveOfflineRoute('routes/playlists.$playlistId')).toBe(true)
		expect(isLiveOfflineRoute('routes/search')).toBe(false)
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

	test('returns empty object for unregistered routes', () => {
		expect(
			resolveOfflineStubForRoute(
				'routes/unknown',
				new Request('https://example.com/unknown'),
			),
		).toEqual({})
	})
})
