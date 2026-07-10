import { describe, expect, test } from 'vitest'
import { computeArchiveQueueSuccessRate } from './queue-stats'

describe('computeArchiveQueueSuccessRate', () => {
	test('counts only finished jobs (completed + failed)', () => {
		// 10 completed, 5 failed, 100 pending, 2 processing → 10/15 ≈ 67%
		expect(computeArchiveQueueSuccessRate(10, 5)).toBe(67)
	})

	test('returns 100% when all finished jobs succeeded', () => {
		expect(computeArchiveQueueSuccessRate(42, 0)).toBe(100)
	})

	test('returns 0% when no jobs have finished yet', () => {
		expect(computeArchiveQueueSuccessRate(0, 0)).toBe(0)
	})

	test('returns 0% when all finished jobs failed', () => {
		expect(computeArchiveQueueSuccessRate(0, 8)).toBe(0)
	})
})
