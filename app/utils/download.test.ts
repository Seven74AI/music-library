/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isIOSDevice, triggerBlobDownload, triggerBrowserDownload } from './download.ts'

describe('isIOSDevice', () => {
	test('detects iPhone user agent', () => {
		expect(
			isIOSDevice({
				userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
				platform: 'iPhone',
				maxTouchPoints: 5,
			}),
		).toBe(true)
	})

	test('returns false for desktop Chrome', () => {
		expect(
			isIOSDevice({
				userAgent:
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
				platform: 'MacIntel',
				maxTouchPoints: 0,
			}),
		).toBe(false)
	})
})

describe('triggerBrowserDownload', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				blob: async () => new Blob(['audio-bytes'], { type: 'audio/mpeg' }),
			}),
		)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test('fetches same-origin stream URL and triggers blob download', async () => {
		const click = vi.fn()
		const link = document.createElement('a')
		link.click = click
		const createElement = vi
			.spyOn(document, 'createElement')
			.mockReturnValue(link as HTMLAnchorElement)
		const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(() => link)
		const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation(() => link)
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const createObjectURL = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValue('blob:https://app.test/audio')

		await triggerBrowserDownload('/resources/audio/track-1?stream=1', 'Song.mp3')

		expect(fetch).toHaveBeenCalledWith('/resources/audio/track-1?stream=1', {
			credentials: 'same-origin',
		})
		expect(createObjectURL).toHaveBeenCalled()
		expect(click).toHaveBeenCalled()
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:https://app.test/audio')

		createElement.mockRestore()
		appendChild.mockRestore()
		removeChild.mockRestore()
		revokeObjectURL.mockRestore()
		createObjectURL.mockRestore()
	})
})

describe('triggerBlobDownload', () => {
	test('uses Web Share API on iOS when available', async () => {
		const share = vi.fn().mockResolvedValue(undefined)
		const canShare = vi.fn().mockReturnValue(true)

		await triggerBlobDownload(new Blob(['audio'], { type: 'audio/mpeg' }), 'Song.mp3', {
			navigatorLike: {
				userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
				platform: 'iPhone',
				maxTouchPoints: 5,
				share,
				canShare,
			},
		})

		expect(share).toHaveBeenCalledTimes(1)
		expect(share.mock.calls[0]?.[0]?.files?.[0]?.name).toBe('Song.mp3')
	})
})
