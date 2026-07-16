/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useSwipeGesture } from './use-swipe-gesture'

// JSDOM does not provide the Touch constructor — polyfill it.
class FakeTouch {
	identifier: number
	target: EventTarget
	clientX: number
	clientY: number
	screenX: number
	screenY: number
	pageX: number
	pageY: number
	radiusX: number
	radiusY: number
	rotationAngle: number
	force: number

	constructor(init: TouchInit) {
		this.identifier = init.identifier
		this.target = init.target!
		this.clientX = init.clientX!
		this.clientY = init.clientY ?? 0
		this.screenX = init.screenX!
		this.screenY = init.screenY ?? 0
		this.pageX = init.pageX!
		this.pageY = init.pageY ?? 0
		this.radiusX = init.radiusX ?? 0
		this.radiusY = init.radiusY ?? 0
		this.rotationAngle = init.rotationAngle ?? 0
		this.force = init.force ?? 0
	}
}

function createTouchEvent(
	type: string,
	clientX: number,
	identifier = 0,
): TouchEvent {
	const touch = new FakeTouch({
		identifier,
		target: document.createElement('div'),
		clientX,
		clientY: 0,
		screenX: clientX,
		screenY: 0,
		pageX: clientX,
		pageY: 0,
		radiusX: 1,
		radiusY: 1,
		rotationAngle: 0,
		force: 1,
	}) as unknown as Touch
	return new TouchEvent(type, {
		touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
		changedTouches: [touch],
		bubbles: true,
	})
}

describe('useSwipeGesture', () => {
	beforeEach(() => {
		vi.stubGlobal('Touch', FakeTouch)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	function setupHook(options = {}) {
		const ref = { current: document.createElement('div') }
		const { result, rerender } = renderHook(
			(opts) => useSwipeGesture(ref, opts),
			{ initialProps: options },
		)
		return { ref, result, rerender }
	}

	test('does not trigger callback when swipe is below threshold', () => {
		const onSwipeLeft = vi.fn()
		const onSwipeRight = vi.fn()
		const { ref } = setupHook({ onSwipeLeft, onSwipeRight, threshold: 50 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 200))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 240))
			ref.current!.dispatchEvent(createTouchEvent('touchend', 240))
		})

		expect(onSwipeLeft).not.toHaveBeenCalled()
		expect(onSwipeRight).not.toHaveBeenCalled()
	})

	test('calls onSwipeLeft when swiping left past threshold', () => {
		const onSwipeLeft = vi.fn()
		const onSwipeRight = vi.fn()
		const { ref } = setupHook({ onSwipeLeft, onSwipeRight, threshold: 50 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 300))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 240))
			ref.current!.dispatchEvent(createTouchEvent('touchend', 240))
		})

		expect(onSwipeLeft).toHaveBeenCalledOnce()
		expect(onSwipeRight).not.toHaveBeenCalled()
	})

	test('calls onSwipeRight when swiping right past threshold', () => {
		const onSwipeLeft = vi.fn()
		const onSwipeRight = vi.fn()
		const { ref } = setupHook({ onSwipeLeft, onSwipeRight, threshold: 50 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 200))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 260))
			ref.current!.dispatchEvent(createTouchEvent('touchend', 260))
		})

		expect(onSwipeRight).toHaveBeenCalledOnce()
		expect(onSwipeLeft).not.toHaveBeenCalled()
	})

	test('triggers at exactly threshold distance', () => {
		const onSwipeRight = vi.fn()
		const { ref } = setupHook({ onSwipeRight, threshold: 49 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 100))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 149))
			ref.current!.dispatchEvent(createTouchEvent('touchend', 149))
		})

		expect(onSwipeRight).toHaveBeenCalledOnce()
	})

	test('exposes offsetX during swipe movement', () => {
		const { ref, result } = setupHook({ threshold: 50 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 100))
		})

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 180))
		})

		expect(result.current.offsetX).toBe(80)
		expect(result.current.isSwiping).toBe(true)
	})

	test('resets offsetX and isSwiping after touch end', () => {
		const { ref, result } = setupHook({ threshold: 50 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 100))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 180))
		})
		expect(result.current.isSwiping).toBe(true)
		expect(result.current.offsetX).toBe(80)

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchend', 180))
		})

		expect(result.current.offsetX).toBe(0)
		expect(result.current.isSwiping).toBe(false)
	})

	test('resets offsetX and isSwiping after touch cancel', () => {
		const { ref, result } = setupHook({ threshold: 50 })

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 100))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 150))
		})
		expect(result.current.isSwiping).toBe(true)

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchcancel', 150))
		})

		expect(result.current.offsetX).toBe(0)
		expect(result.current.isSwiping).toBe(false)
	})

	test('does not respond to touch events when disabled', () => {
		const onSwipeLeft = vi.fn()
		const onSwipeRight = vi.fn()
		const { ref, result } = setupHook({
			onSwipeLeft,
			onSwipeRight,
			threshold: 50,
			enabled: false,
		})

		act(() => {
			ref.current!.dispatchEvent(createTouchEvent('touchstart', 300))
			ref.current!.dispatchEvent(createTouchEvent('touchmove', 240))
			ref.current!.dispatchEvent(createTouchEvent('touchend', 240))
		})

		expect(onSwipeLeft).not.toHaveBeenCalled()
		expect(onSwipeRight).not.toHaveBeenCalled()
		expect(result.current.offsetX).toBe(0)
		expect(result.current.isSwiping).toBe(false)
	})

	test('ignores multi-touch gestures', () => {
		const onSwipeLeft = vi.fn()
		const onSwipeRight = vi.fn()
		const { ref, result } = setupHook({
			onSwipeLeft,
			onSwipeRight,
			threshold: 50,
		})

		const touch1 = new FakeTouch({
			identifier: 0,
			target: document.createElement('div'),
			clientX: 200,
			clientY: 0,
			screenX: 200,
			screenY: 0,
			pageX: 200,
			pageY: 0,
			radiusX: 1,
			radiusY: 1,
			rotationAngle: 0,
			force: 1,
		}) as unknown as Touch
		const touch2 = new FakeTouch({
			identifier: 1,
			target: document.createElement('div'),
			clientX: 300,
			clientY: 0,
			screenX: 300,
			screenY: 0,
			pageX: 300,
			pageY: 0,
			radiusX: 1,
			radiusY: 1,
			rotationAngle: 0,
			force: 1,
		}) as unknown as Touch

		act(() => {
			ref.current!.dispatchEvent(
				new TouchEvent('touchstart', {
					touches: [touch1],
					changedTouches: [touch1],
					bubbles: true,
				}),
			)
			ref.current!.dispatchEvent(
				new TouchEvent('touchmove', {
					touches: [touch1, touch2],
					changedTouches: [touch2],
					bubbles: true,
				}),
			)
			ref.current!.dispatchEvent(
				new TouchEvent('touchend', {
					touches: [],
					changedTouches: [touch1, touch2],
					bubbles: true,
				}),
			)
		})

		expect(onSwipeLeft).not.toHaveBeenCalled()
		expect(onSwipeRight).not.toHaveBeenCalled()
		expect(result.current.offsetX).toBe(0)
	})
})
