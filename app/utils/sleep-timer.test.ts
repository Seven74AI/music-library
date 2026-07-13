import { describe, expect, test } from 'vitest'
import {
	createSleepTimerEndAt,
	formatSleepTimerRemaining,
	getSleepTimerRemainingMs,
	isSleepTimerExpired,
} from './sleep-timer.ts'

test('createSleepTimerEndAt returns null for invalid durations', () => {
	expect(createSleepTimerEndAt(0, 1_000)).toBeNull()
	expect(createSleepTimerEndAt(-5, 1_000)).toBeNull()
})

test('createSleepTimerEndAt adds minutes in milliseconds', () => {
	expect(createSleepTimerEndAt(15, 1_000)).toBe(1_000 + 15 * 60_000)
})

test('formatSleepTimerRemaining renders mm:ss', () => {
	const endAt = 1_000 + 90_500
	expect(formatSleepTimerRemaining(endAt, 1_000)).toBe('1:31')
})

test('isSleepTimerExpired detects elapsed timers', () => {
	const endAt = createSleepTimerEndAt(1, 1_000)!
	expect(isSleepTimerExpired(endAt, 1_000 + 60_000)).toBe(true)
	expect(getSleepTimerRemainingMs(endAt, 1_000)).toBe(60_000)
})

describe('edge cases: negative time format, rapid start/stop race condition', () => {
	test('formatSleepTimerRemaining returns null when remaining time is negative', () => {
		// endAt in the past — remainingMs becomes 0 via Math.max(0, ...)
		const endAt = 1_000
		const now = 2_000 // 1 second past endAt
		expect(formatSleepTimerRemaining(endAt, now)).toBeNull()
	})

	test('formatSleepTimerRemaining handles endAt exactly at now', () => {
		const endAt = 1_000
		const now = 1_000
		expect(formatSleepTimerRemaining(endAt, now)).toBeNull()
	})

	test('rapid start/stop cycle: createSleepTimerEndAt then immediately check remaining', () => {
		const now = 1_000_000
		const endAt = createSleepTimerEndAt(15, now)!
		// Immediately after creation, remaining should be close to 15 min
		expect(getSleepTimerRemainingMs(endAt, now)).toBe(15 * 60_000)
		// Not yet expired
		expect(isSleepTimerExpired(endAt, now)).toBe(false)
	})

	test('getSleepTimerRemainingMs returns 0 for null endAt', () => {
		expect(getSleepTimerRemainingMs(null, 1_000)).toBe(0)
	})

	test('isSleepTimerExpired returns false for null endAt', () => {
		expect(isSleepTimerExpired(null, 1_000)).toBe(false)
	})
})
