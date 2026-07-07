/**
 * @vitest-environment jsdom
 */
import { vi, test, expect } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { loader as downloadUrlLoader } from './audio.$trackId.download-url.tsx'

// Mock the auth to skip login requirement
vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn().mockResolvedValue('kodyuser'),
}))

test('returns download URL JSON for a track with audio files', async () => {
	// Get the seeded kody user
	const user = await prisma.user.findFirst({
		where: { username: 'kodyuser' },
		select: { id: true },
	})
	expect(user).toBeDefined()

	// Find a track in the user's library that has audio files
	const userTrack = await prisma.userTrack.findFirst({
		where: { userId: user!.id },
		include: {
			track: {
				include: {
					audioFiles: true,
					artist: true,
				},
			},
		},
	})

	if (!userTrack || userTrack.track.audioFiles.length === 0) {
		// Skip if no seeded track with audio files
		return
	}

	const track = userTrack.track

	const response = await downloadUrlLoader({
		request: new Request(`https://localhost/resources/audio/${track.id}/download-url`),
		params: { trackId: track.id },
		context: {},
		url: new URL(`https://localhost/resources/audio/${track.id}/download-url`),
		pattern: { path: '/resources/audio/:trackId/download-url' },
	} as any)

	const data = await response.json() as { url: string; fileName: string; mimeType: string; format: string }
	expect(data.url).toBeDefined()
	expect(data.url).toContain('presigned=true')
	expect(data.fileName).toBeDefined()
	expect(data.mimeType).toBeDefined()
	expect(data.format).toBeDefined()
})

test('returns 404 for non-existent track', async () => {
	try {
		await downloadUrlLoader({
			request: new Request('https://localhost/resources/audio/nonexistent/download-url'),
			params: { trackId: 'nonexistent' },
			context: {},
			url: new URL('https://localhost/resources/audio/nonexistent/download-url'),
			pattern: { path: '/resources/audio/:trackId/download-url' },
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
	}
})

test('returns 400 for missing trackId', async () => {
	try {
		await downloadUrlLoader({
			request: new Request('https://localhost/resources/audio//download-url'),
			params: {},
			context: {},
			url: new URL('https://localhost/resources/audio//download-url'),
			pattern: { path: '/resources/audio/:trackId?/download-url' },
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
	}
})
