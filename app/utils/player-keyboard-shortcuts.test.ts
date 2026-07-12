/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest'
import {
	adjustVolumeStep,
	getPlayerKeyboardAction,
	shouldIgnoreKeyboardShortcut,
} from './player-keyboard-shortcuts.ts'

test('shouldIgnoreKeyboardShortcut ignores form fields', () => {
	const input = document.createElement('input')
	expect(shouldIgnoreKeyboardShortcut(input)).toBe(true)
})

test('shouldIgnoreKeyboardShortcut allows body clicks', () => {
	expect(shouldIgnoreKeyboardShortcut(document.body)).toBe(false)
})

test('shouldIgnoreKeyboardShortcut ignores range inputs', () => {
	const range = document.createElement('input')
	range.type = 'range'
	expect(shouldIgnoreKeyboardShortcut(range)).toBe(true)
})

test('shouldIgnoreKeyboardShortcut ignores buttons', () => {
	const button = document.createElement('button')
	expect(shouldIgnoreKeyboardShortcut(button)).toBe(true)
})

test('shouldIgnoreKeyboardShortcut ignores anchor elements', () => {
	const anchor = document.createElement('a')
	expect(shouldIgnoreKeyboardShortcut(anchor)).toBe(true)
})

test('shouldIgnoreKeyboardShortcut ignores summary elements', () => {
	const summary = document.createElement('summary')
	expect(shouldIgnoreKeyboardShortcut(summary)).toBe(true)
})

test('getPlayerKeyboardAction maps space to toggle play/pause', () => {
	expect(
		getPlayerKeyboardAction({
			key: ' ',
			code: 'Space',
			target: document.body,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		}),
	).toBe('toggle-play-pause')
})

test('getPlayerKeyboardAction maps arrow keys to navigation and volume', () => {
	expect(
		getPlayerKeyboardAction({
			key: 'ArrowRight',
			code: 'ArrowRight',
			target: document.body,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		}),
	).toBe('next')

	expect(
		getPlayerKeyboardAction({
			key: 'ArrowUp',
			code: 'ArrowUp',
			target: document.body,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		}),
	).toBe('volume-up')
})

test('getPlayerKeyboardAction ignores shortcuts with modifiers', () => {
	expect(
		getPlayerKeyboardAction({
			key: ' ',
			code: 'Space',
			target: document.body,
			metaKey: true,
			ctrlKey: false,
			altKey: false,
		}),
	).toBeNull()
})

test('adjustVolumeStep changes volume in 5% steps', () => {
	expect(adjustVolumeStep(0.5, 'up')).toBeCloseTo(0.55)
	expect(adjustVolumeStep(0.02, 'down')).toBe(0)
	expect(adjustVolumeStep(0.98, 'up')).toBe(1)
})

test('getPlayerKeyboardAction ignores space on focused button', () => {
	const button = document.createElement('button')
	expect(
		getPlayerKeyboardAction({
			key: ' ',
			code: 'Space',
			target: button,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		}),
	).toBeNull()
})

test('getPlayerKeyboardAction ignores space on focused link', () => {
	const anchor = document.createElement('a')
	expect(
		getPlayerKeyboardAction({
			key: ' ',
			code: 'Space',
			target: anchor,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		}),
	).toBeNull()
})

test('getPlayerKeyboardAction ignores arrow keys on range input', () => {
	const range = document.createElement('input')
	range.type = 'range'
	expect(
		getPlayerKeyboardAction({
			key: 'ArrowRight',
			code: 'ArrowRight',
			target: range,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		}),
	).toBeNull()
})
