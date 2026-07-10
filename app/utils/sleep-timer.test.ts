import { expect, test } from 'vitest'
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
