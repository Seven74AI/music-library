import { ErrorCategory, type ErrorCategory as ErrorCategoryType } from './yt-dlp.server.ts'

export const COOKIE_FAILURE_PAUSE_THRESHOLD = 3

export function isCookieExpiredFailure(category: ErrorCategoryType | string): boolean {
	return category === ErrorCategory.COOKIE_EXPIRED
}

export function createCookieFailureStreak(threshold = COOKIE_FAILURE_PAUSE_THRESHOLD) {
	let count = 0

	return {
		recordFailure(): boolean {
			count++
			if (count >= threshold) {
				count = 0
				return true
			}
			return false
		},
		recordSuccess(): void {
			count = 0
		},
		reset(): void {
			count = 0
		},
		getCount(): number {
			return count
		},
	}
}

const cookieFailureStreak = createCookieFailureStreak()

/** Record a cookie-expired failure; returns true when the queue should pause. */
export function recordCookieExpiredFailure(): boolean {
	return cookieFailureStreak.recordFailure()
}

export function recordArchiveSuccess(): void {
	cookieFailureStreak.recordSuccess()
}

export function resetCookieFailureStreak(): void {
	cookieFailureStreak.reset()
}
