/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { TrackThumbnail } from './track-thumbnail.tsx'

test('requests larger proxy dimensions when pixelSize is provided', () => {
	render(
		<TrackThumbnail
			coverImage={{ objectKey: 'images/tracks/track-1/cover.jpg' }}
			alt="Midnight City"
			size="lg"
			pixelSize={320}
			className="h-full w-full"
		/>,
	)

	const image = screen.getByRole('img', { name: 'Midnight City' })
	expect(image).toHaveAttribute(
		'src',
		'/resources/images?src=images%2Ftracks%2Ftrack-1%2Fcover.jpg&w=320&h=320&fit=cover&format=webp',
	)
})

test('defaults to 2x size-based proxy dimensions', () => {
	render(
		<TrackThumbnail
			coverImage={{ objectKey: 'images/tracks/track-1/cover.jpg' }}
			alt="Midnight City"
			size="sm"
		/>,
	)

	const image = screen.getByRole('img', { name: 'Midnight City' })
	expect(image.getAttribute('src')).toContain('w=80')
	expect(image.getAttribute('src')).toContain('h=80')
})

// ── Fallback chain scenarios ──

test('renders placeholder when coverImage is null and no thumbnailUrl', () => {
	const { container } = render(
		<TrackThumbnail
			coverImage={null}
			alt="No Cover"
			size="md"
		/>,
	)

	// Should NOT render an <img>
	expect(screen.queryByRole('img')).toBeNull()

	// Should render the placeholder div with bg-muted and an SVG icon
	const placeholder = container.querySelector('.bg-muted')
	expect(placeholder).toBeTruthy()

	const svg = placeholder?.querySelector('svg')
	expect(svg).toBeTruthy()
})

test('uses thumbnailUrl as fallback when coverImage is missing', () => {
	const thumbnailUrl = 'https://img.youtube.com/vi/dQw4w9WgXcQ/default.jpg'

	render(
		<TrackThumbnail
			coverImage={undefined}
			thumbnailUrl={thumbnailUrl}
			alt="YouTube Thumbnail"
			size="md"
		/>,
	)

	const image = screen.getByRole('img', { name: 'YouTube Thumbnail' })
	expect(image).toHaveAttribute('src', thumbnailUrl)
})

test('uses thumbnailUrl as fallback when coverImage is null', () => {
	const thumbnailUrl = 'https://img.youtube.com/vi/dQw4w9WgXcQ/default.jpg'

	render(
		<TrackThumbnail
			coverImage={null}
			thumbnailUrl={thumbnailUrl}
			alt="Null Cover + Thumb"
			size="sm"
		/>,
	)

	const image = screen.getByRole('img', { name: 'Null Cover + Thumb' })
	expect(image).toHaveAttribute('src', thumbnailUrl)
})

// ── Size classes ──

test.each([
	{ size: 'xs', expectedClass: 'h-8 w-8', description: 'xs → h-8 w-8' },
	{ size: 'sm', expectedClass: 'h-10 w-10', description: 'sm → h-10 w-10' },
	{ size: 'md', expectedClass: 'h-12 w-12', description: 'md → h-12 w-12' },
	{ size: 'lg', expectedClass: 'h-14 w-14', description: 'lg → h-14 w-14' },
] as const)('applies correct size class: $description', ({ size, expectedClass }) => {
	render(
		<TrackThumbnail
			coverImage={{ objectKey: 'covers/test.jpg' }}
			alt="Size Test"
			size={size}
		/>,
	)

	const image = screen.getByRole('img', { name: 'Size Test' })
	expect(image.className).toContain(expectedClass)
})

// ── className merge ──

test('merges custom className with base classes on image', () => {
	render(
		<TrackThumbnail
			coverImage={{ objectKey: 'covers/test.jpg' }}
			alt="Custom Class"
			size="md"
			className="my-custom-class ring-2"
		/>,
	)

	const image = screen.getByRole('img', { name: 'Custom Class' })
	expect(image.className).toContain('my-custom-class')
	expect(image.className).toContain('ring-2')
	// Base classes should still be present
	expect(image.className).toContain('rounded')
	expect(image.className).toContain('object-cover')
})

test('merges custom className with base classes on placeholder', () => {
	const { container } = render(
		<TrackThumbnail
			coverImage={null}
			alt="Placeholder + Class"
			size="md"
			className="placeholder-custom border"
		/>,
	)

	const placeholder = container.querySelector('.bg-muted')
	expect(placeholder).toBeTruthy()
	expect(placeholder!.className).toContain('placeholder-custom')
	expect(placeholder!.className).toContain('border')
	// Base classes should still be present
	expect(placeholder!.className).toContain('rounded')
	expect(placeholder!.className).toContain('flex')
})
