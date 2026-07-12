import { describe, expect, test } from 'vitest'
import { type QueueTrack } from '#app/types/frontend/shared.ts'
import {
	getSpinePlayOrder,
	hasNextTrack,
	hasPreviousTrack,
	resolveNextTrack,
	resolvePreviousTrack,
	type QueueNavigationState,
} from './queue-navigation.ts'

function track(id: string): QueueTrack {
	return { id, title: `Track ${id}`, artist: { id: 'a1', name: 'Artist' } }
}

function baseState(
	overrides: Partial<QueueNavigationState> = {},
): QueueNavigationState {
	return {
		upNext: [],
		spine: [track('s1'), track('s2'), track('s3')],
		spineOrder: [0, 1, 2],
		spinePosition: 0,
		loopMode: 'off',
		...overrides,
	}
}

describe('resolveNextTrack', () => {
	test('drains Up Next front before advancing the spine', () => {
		const state = baseState({
			upNext: [track('u1'), track('u2')],
			spinePosition: 1,
		})

		expect(resolveNextTrack(state)).toEqual({ zone: 'upNext', index: 0 })
	})

	test('advances the spine when Up Next is empty', () => {
		const state = baseState({ spinePosition: 0 })

		expect(resolveNextTrack(state)).toEqual({ zone: 'spine', index: 1 })
	})

	test('follows shuffled spine order', () => {
		const state = baseState({
			spineOrder: [2, 0, 1],
			spinePosition: 0,
		})

		expect(resolveNextTrack(state)).toEqual({ zone: 'spine', index: 1 })
	})

	test('wraps to the first spine track when loop all is enabled', () => {
		const state = baseState({
			spinePosition: 2,
			loopMode: 'all',
		})

		expect(resolveNextTrack(state)).toEqual({ zone: 'spine', index: 0 })
	})

	test('replays the current spine track when loop one is enabled', () => {
		const state = baseState({
			spinePosition: 1,
			loopMode: 'one',
		})

		expect(resolveNextTrack(state)).toEqual({ zone: 'spine', index: 1 })
	})

	test('returns null at end of spine with loop off', () => {
		const state = baseState({ spinePosition: 2 })

		expect(resolveNextTrack(state)).toBeNull()
	})
})

describe('resolvePreviousTrack', () => {
	test('walks back through the spine play order', () => {
		const state = baseState({ spinePosition: 2 })

		expect(resolvePreviousTrack(state)).toEqual({ zone: 'spine', index: 1 })
	})

	test('wraps to the last spine track when loop all is enabled', () => {
		const state = baseState({
			spinePosition: 0,
			loopMode: 'all',
		})

		expect(resolvePreviousTrack(state)).toEqual({ zone: 'spine', index: 2 })
	})

	test('replays the current spine track when loop one is enabled', () => {
		const state = baseState({
			spinePosition: 1,
			loopMode: 'one',
		})

		expect(resolvePreviousTrack(state)).toEqual({ zone: 'spine', index: 1 })
	})

	test('returns null at the start of the spine with loop off', () => {
		const state = baseState({ spinePosition: 0 })

		expect(resolvePreviousTrack(state)).toBeNull()
	})
})

describe('hasNextTrack / hasPreviousTrack', () => {
	test('hasNext is true when Up Next has items', () => {
		expect(hasNextTrack(baseState({ upNext: [track('u1')] }))).toBe(true)
	})

	test('hasNext is true when more spine tracks remain', () => {
		expect(hasNextTrack(baseState({ spinePosition: 0 }))).toBe(true)
	})

	test('hasNext is true for loop all at end of spine', () => {
		expect(
			hasNextTrack(baseState({ spinePosition: 2, loopMode: 'all' })),
		).toBe(true)
	})

	test('hasPrevious reflects spine position and loop mode', () => {
		expect(hasPreviousTrack(baseState({ spinePosition: 0 }))).toBe(false)
		expect(
			hasPreviousTrack(baseState({ spinePosition: 0, loopMode: 'all' })),
		).toBe(true)
	})
})

describe('getSpinePlayOrder', () => {
	test('returns spine tracks in play order from the current position', () => {
		const state = baseState({
			spineOrder: [2, 0, 1],
			spinePosition: 1,
		})

		expect(getSpinePlayOrder(state).map(track => track.id)).toEqual([
			's1',
			's2',
		])
	})
})
