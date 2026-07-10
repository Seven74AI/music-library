import { describe, expect, test } from 'vitest'
import {
	PWA_INSTALL_DISMISS_KEY,
	isIosSafari,
	isStandaloneDisplayMode,
	shouldShowInstallPrompt,
} from './pwa-install.client.ts'

describe('isStandaloneDisplayMode', () => {
	test('returns true when display-mode is standalone', () => {
		const result = isStandaloneDisplayMode({
			matchMedia: (query: string) =>
				({ matches: query === '(display-mode: standalone)' }) as MediaQueryList,
			navigator: { standalone: false } as Navigator & { standalone?: boolean },
		})

		expect(result).toBe(true)
	})

	test('returns true when iOS navigator.standalone is set', () => {
		const result = isStandaloneDisplayMode({
			matchMedia: () => ({ matches: false }) as MediaQueryList,
			navigator: { standalone: true } as Navigator & { standalone?: boolean },
		})

		expect(result).toBe(true)
	})

	test('returns false in a normal browser tab', () => {
		const result = isStandaloneDisplayMode({
			matchMedia: () => ({ matches: false }) as MediaQueryList,
			navigator: { standalone: false } as Navigator & { standalone?: boolean },
		})

		expect(result).toBe(false)
	})
})

describe('isIosSafari', () => {
	test('detects iPhone Safari', () => {
		expect(
			isIosSafari(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
			),
		).toBe(true)
	})

	test('does not treat Chrome on Android as iOS Safari', () => {
		expect(
			isIosSafari(
				'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
			),
		).toBe(false)
	})
})

describe('shouldShowInstallPrompt', () => {
	test('hides when already installed', () => {
		expect(
			shouldShowInstallPrompt({ isStandalone: true, dismissed: false }),
		).toBe(false)
	})

	test('hides when dismissed', () => {
		expect(
			shouldShowInstallPrompt({ isStandalone: false, dismissed: true }),
		).toBe(false)
	})

	test('shows when not installed and not dismissed', () => {
		expect(
			shouldShowInstallPrompt({ isStandalone: false, dismissed: false }),
		).toBe(true)
	})
})

test('PWA_INSTALL_DISMISS_KEY is stable', () => {
	expect(PWA_INSTALL_DISMISS_KEY).toBe('music-library:pwa-install-dismissed')
})
