/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	PLAYER_VOLUME_STORAGE_KEY,
	DEFAULT_PLAYER_VOLUME,
	clampVolume,
	readStoredVolume,
	writeStoredVolume,
} from './player-preferences.ts'

afterEach(() => {
	window.localStorage.clear()
})

test('clampVolume keeps values between 0 and 1', () => {
	expect(clampVolume(-0.5)).toBe(0)
	expect(clampVolume(0.42)).toBe(0.42)
	expect(clampVolume(2)).toBe(1)
	expect(clampVolume(Number.NaN)).toBe(DEFAULT_PLAYER_VOLUME)
})

test('readStoredVolume returns default when nothing is stored', () => {
	expect(readStoredVolume()).toBe(DEFAULT_PLAYER_VOLUME)
})

test('writeStoredVolume persists clamped volume', () => {
	writeStoredVolume(0.65)
	expect(window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY)).toBe('0.65')
	expect(readStoredVolume()).toBe(0.65)
})

test('writeStoredVolume clamps out-of-range values', () => {
	writeStoredVolume(5)
	expect(readStoredVolume()).toBe(1)
})

describe('edge cases: SSR, corrupted localStorage, quota exceeded', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test('readStoredVolume returns default when window is undefined (SSR)', () => {
		vi.stubGlobal('window', undefined)
		expect(readStoredVolume()).toBe(DEFAULT_PLAYER_VOLUME)
	})

	test('writeStoredVolume does not throw when window is undefined (SSR)', () => {
		vi.stubGlobal('window', undefined)
		expect(() => writeStoredVolume(0.5)).not.toThrow()
	})

	test('readStoredVolume handles corrupted localStorage value gracefully', () => {
		window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, 'not-a-number')
		expect(readStoredVolume()).toBe(DEFAULT_PLAYER_VOLUME)
	})

	test('readStoredVolume handles NaN in localStorage gracefully', () => {
		window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, 'NaN')
		expect(readStoredVolume()).toBe(DEFAULT_PLAYER_VOLUME)
	})

	test('writeStoredVolume does not throw when localStorage is full (quota exceeded)', () => {
		const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
		window.localStorage.setItem = vi
			.fn()
			.mockImplementation(() => {
				throw new DOMException('QuotaExceededError', 'QuotaExceededError')
			})
		expect(() => writeStoredVolume(0.75)).not.toThrow()
		// Restore for other tests
		window.localStorage.setItem = originalSetItem
	})
})
