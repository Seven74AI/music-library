/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useOnlineStatus } from './use-online-status.ts'

describe('useOnlineStatus', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test('reflects navigator.onLine on first render', () => {
		vi.stubGlobal('navigator', { onLine: false })
		const { result } = renderHook(() => useOnlineStatus())
		expect(result.current).toBe(false)
	})

	test('starts online when navigator reports online on first render', () => {
		vi.stubGlobal('navigator', { onLine: true })
		const { result } = renderHook(() => useOnlineStatus())
		expect(result.current).toBe(true)
	})

	test('updates when browser fires offline and online events', () => {
		vi.stubGlobal('navigator', { onLine: true })
		const { result } = renderHook(() => useOnlineStatus())
		expect(result.current).toBe(true)

		act(() => {
			window.dispatchEvent(new Event('offline'))
		})
		expect(result.current).toBe(false)

		act(() => {
			window.dispatchEvent(new Event('online'))
		})
		expect(result.current).toBe(true)
	})
})
