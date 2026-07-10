import { describe, expect, test } from 'vitest'
import {
	CursorSchema,
	SearchLimitSchema,
	SearchQuerySchema,
	SearchTypeSchema,
	validateSearchQuery,
} from './search-validation.server.ts'

describe('search-validation.server', () => {
	test('rejects empty search query', () => {
		const result = SearchQuerySchema.safeParse('')
		expect(result.success).toBe(false)
		expect(() => validateSearchQuery('')).toThrow()
	})

	test('rejects missing query parameter value', () => {
		const result = SearchQuerySchema.safeParse('')
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.errors[0]?.message).toMatch(/empty/i)
		}
	})

	test('accepts valid search query', () => {
		const result = SearchQuerySchema.safeParse('test track')
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data).toBe('test track')
		}
	})

	test('rejects invalid search limit', () => {
		const result = SearchLimitSchema.safeParse(Number.NaN)
		expect(result.success).toBe(false)
	})

	test('accepts valid search type', () => {
		const result = SearchTypeSchema.safeParse('tracks')
		expect(result.success).toBe(true)
	})

	test('accepts undefined cursor', () => {
		const result = CursorSchema.safeParse(undefined)
		expect(result.success).toBe(true)
	})
})
