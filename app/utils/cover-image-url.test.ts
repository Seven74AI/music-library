import { describe, expect, test } from 'vitest'
import {
	coverImageUrl,
	playlistCoverPixelSizes,
	trackThumbnailPixelSizes,
} from './cover-image-url.ts'

describe('coverImageUrl', () => {
	test('builds a square proxied cover URL', () => {
		expect(coverImageUrl('images/tracks/a/cover.jpg', 128)).toBe(
			'/resources/images?src=images%2Ftracks%2Fa%2Fcover.jpg&w=128&h=128&fit=cover&format=webp',
		)
	})

	// Edge case 1: empty string objectKey
	test('handles empty string objectKey', () => {
		const url = coverImageUrl('', 64)
		expect(url).toBe(
			'/resources/images?src=&w=64&h=64&fit=cover&format=webp',
		)
	})

	// Edge case 2: special characters requiring URL encoding
	describe('special characters in objectKey', () => {
		test('encodes spaces', () => {
			const url = coverImageUrl('my cover art.jpg', 80)
			expect(url).toContain('my%20cover%20art.jpg')
			expect(url).not.toContain(' ')
		})

		test('encodes unicode characters', () => {
			const url = coverImageUrl('café/über/東京.jpg', 96)
			// é = %C3%A9, ü = %C3%BC, 東京 gets percent-encoded
			expect(url).not.toContain('é')
			expect(url).not.toContain('ü')
			expect(url).not.toContain('東京')
			expect(url).toMatch(/src=caf%C3%A9%2F%C3%BCber%2F%E6%9D%B1%E4%BA%AC\.jpg/)
		})

		test('encodes ampersand to prevent query param splitting (double-encoding)', () => {
			const url = coverImageUrl('track&artist=foo.jpg', 128)
			// & must NOT appear literally — it would be treated as a new query param
			expect(url).not.toContain('&artist=')
			// encodeURIComponent encodes & as %26
			expect(url).toContain('track%26artist%3Dfoo.jpg')
		})

		test('encodes combined special characters', () => {
			const url = coverImageUrl('rock & röll + more.jpg', 112)
			// & → %26, ö → %C3%B6, spaces → %20, + → %2B
			expect(url).not.toContain(' & ')
			expect(url).not.toContain(' + ')
			expect(url).toMatch(
				/src=rock%20%26%20r%C3%B6ll%20%2B%20more\.jpg/,
			)
		})
	})

	// Edge case 3: extreme pixelSize values
	describe('extreme pixelSize values', () => {
		test('handles pixelSize 0', () => {
			const url = coverImageUrl('cover.jpg', 0)
			expect(url).toBe(
				'/resources/images?src=cover.jpg&w=0&h=0&fit=cover&format=webp',
			)
		})

		test('handles negative pixelSize', () => {
			const url = coverImageUrl('cover.jpg', -1)
			expect(url).toBe(
				'/resources/images?src=cover.jpg&w=-1&h=-1&fit=cover&format=webp',
			)
		})

		test('handles very large pixelSize', () => {
			const url = coverImageUrl('cover.jpg', 99999)
			expect(url).toBe(
				'/resources/images?src=cover.jpg&w=99999&h=99999&fit=cover&format=webp',
			)
		})

		test('handles fractional pixelSize (floor expected by proxy)', () => {
			const url = coverImageUrl('cover.jpg', 64.5)
			// JS template literal coerces number to string — no floor applied here,
			// but this documents the current behavior
			expect(url).toContain('w=64.5')
			expect(url).toContain('h=64.5')
		})
	})

	// Edge case 4: null/undefined objectKey runtime behavior
	// TS forbids null/undefined because objectKey is typed `string`, but
	// runtime JS callers may pass them. These tests verify the behavior.
	describe('null and undefined objectKey (runtime)', () => {
		test('null objectKey is coerced to string "null" by encodeURIComponent', () => {
			const url = coverImageUrl(null as any, 128)
			expect(url).toBe(
				'/resources/images?src=null&w=128&h=128&fit=cover&format=webp',
			)
		})

		test('undefined objectKey is coerced to string "undefined" by encodeURIComponent', () => {
			const url = coverImageUrl(undefined as any, 128)
			expect(url).toBe(
				'/resources/images?src=undefined&w=128&h=128&fit=cover&format=webp',
			)
		})
	})
})

describe('pixel size maps', () => {
	test('uses 2x track thumbnail sizes for retina', () => {
		expect(trackThumbnailPixelSizes).toEqual({
			xs: 64,
			sm: 80,
			md: 96,
			lg: 112,
		})
	})

	test('uses 2x playlist cover sizes for retina', () => {
		expect(playlistCoverPixelSizes).toEqual({
			sm: 128,
			md: 192,
			lg: 256,
		})
	})
})
