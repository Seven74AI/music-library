/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from 'vitest'
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

describe('edge cases: contentEditable ancestor, range input, button/link focus', () => {
	test('shouldIgnoreKeyboardShortcut returns true for element inside contentEditable ancestor', () => {
		const editable = document.createElement('div')
		editable.setAttribute('contenteditable', 'true')
		const span = document.createElement('span')
		editable.appendChild(span)

		expect(shouldIgnoreKeyboardShortcut(span)).toBe(true)
	})

	test('shouldIgnoreKeyboardShortcut returns true for range input', () => {
		const range = document.createElement('input')
		range.type = 'range'
		expect(shouldIgnoreKeyboardShortcut(range)).toBe(true)
	})

	test('getPlayerKeyboardAction returns action for space on focused button', () => {
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
		).toBe('toggle-play-pause')
	})

	test('getPlayerKeyboardAction returns action for space on focused anchor', () => {
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
		).toBe('toggle-play-pause')
	})
})
