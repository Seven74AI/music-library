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
