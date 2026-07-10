/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from 'vitest'
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
