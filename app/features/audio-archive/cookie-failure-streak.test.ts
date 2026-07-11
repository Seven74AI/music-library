import { describe, expect, it, beforeEach } from 'vitest'
import {
	COOKIE_FAILURE_PAUSE_THRESHOLD,
	createCookieFailureStreak,
	isCookieExpiredFailure,
} from './cookie-failure-streak.ts'

describe('isCookieExpiredFailure', () => {
	it('returns true only for COOKIE_EXPIRED', () => {
		expect(isCookieExpiredFailure('COOKIE_EXPIRED')).toBe(true)
		expect(isCookieExpiredFailure('AUTH')).toBe(false)
		expect(isCookieExpiredFailure('FORMAT_UNAVAILABLE')).toBe(false)
	})
})

describe('createCookieFailureStreak', () => {
	let streak: ReturnType<typeof createCookieFailureStreak>

	beforeEach(() => {
		streak = createCookieFailureStreak(3)
	})

	it('does not pause before the threshold', () => {
		expect(streak.recordFailure()).toBe(false)
		expect(streak.recordFailure()).toBe(false)
		expect(streak.getCount()).toBe(2)
	})

	it('pauses on the third consecutive failure and resets the counter', () => {
		expect(streak.recordFailure()).toBe(false)
		expect(streak.recordFailure()).toBe(false)
		expect(streak.recordFailure()).toBe(true)
		expect(streak.getCount()).toBe(0)
	})

	it('resets the counter after a successful job', () => {
		streak.recordFailure()
		streak.recordFailure()
		streak.recordSuccess()
		expect(streak.getCount()).toBe(0)
		expect(streak.recordFailure()).toBe(false)
	})

	it('uses the default threshold constant', () => {
		expect(COOKIE_FAILURE_PAUSE_THRESHOLD).toBe(3)
	})
})
