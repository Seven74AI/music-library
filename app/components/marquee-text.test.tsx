/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { MarqueeText } from './marquee-text'

let capturedCallback: (() => void) | null = null

beforeEach(() => {
	capturedCallback = null
	function MockResizeObserver(this: any, callback: () => void) {
		capturedCallback = callback
	}
	MockResizeObserver.prototype.observe = vi.fn()
	MockResizeObserver.prototype.unobserve = vi.fn()
	MockResizeObserver.prototype.disconnect = vi.fn()
	vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

test('renders text without animation when it fits', async () => {
	const { container } = render(
		<div style={{ width: '200px' }}>
			<MarqueeText>Short</MarqueeText>
		</div>,
	)

	// The effect fires on mount, capturing this callback. Now we can trigger re-measure.
	await act(async () => {
		capturedCallback?.()
	})

	// Should NOT have animated spans since text is short
	const animated = container.querySelectorAll('span.animate-marquee')
	expect(animated.length).toBe(0)
})

test('renders text with animation when it overflows', async () => {
	// Render before stubbing ResizeObserver with overflow measurements
	const { container } = render(
		<div style={{ width: '100px' }}>
			<MarqueeText>Very long text that overflows the container</MarqueeText>
		</div>,
	)

	// Get the inner spans and force overflow detection
	const marqueeDiv = container.querySelector('div.overflow-hidden')
	const textSpan = marqueeDiv?.querySelector('span')
	if (!marqueeDiv || !textSpan) throw new Error('Elements not found')

	// Force overflow: make scrollWidth > clientWidth
	Object.defineProperty(marqueeDiv, 'clientWidth', { value: 80, writable: true, configurable: true })
	Object.defineProperty(textSpan, 'scrollWidth', { value: 200, writable: true, configurable: true })

	await act(async () => {
		capturedCallback?.()
	})

	const animated = container.querySelectorAll('span.animate-marquee')
	expect(animated.length).toBe(1)
	expect((animated[0] as HTMLSpanElement).textContent).toBe('Very long text that overflows the container')
})
