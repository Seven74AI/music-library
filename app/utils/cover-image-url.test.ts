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
