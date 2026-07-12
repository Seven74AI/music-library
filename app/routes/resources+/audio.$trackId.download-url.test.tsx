/**
 * @vitest-environment jsdom
 */
import { vi, test, expect } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.js'
import { prisma } from '#app/utils/db.server.ts'
import { loader as downloadUrlLoader } from './audio.$trackId.download-url.tsx'

// Mock the auth to skip login requirement
vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

test('returns download URL JSON for a track with audio files', async () => {
	// Get the seeded kody user
	const user = await prisma.user.findFirst({
		where: { username: 'kodyuser' },
		select: { id: true },
	})
	expect(user).toBeDefined()
	vi.mocked(requireUserId).mockResolvedValue(user!.id)

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

test('returns download URL JSON for a track accessible only via user-created playlist', async () => {
	const suffix = `download-url-up-${Date.now()}`

	// Get the seeded kody user
	const user = await prisma.user.findFirst({
		where: { username: 'kodyuser' },
		select: { id: true },
	})
	expect(user).toBeDefined()
	vi.mocked(requireUserId).mockResolvedValue(user!.id)

	// Create a service for the track
	const service = await prisma.service.create({
		data: {
			name: `dut-svc-${suffix}`,
			displayName: 'Download URL Test Service',
			baseUrl: 'https://test.example.com',
		},
	})

	// Create a track with an audio file
	const track = await prisma.track.create({
		data: {
			title: 'User Playlist Test Track',
			externalId: `ext-${suffix}`,
			service: { connect: { id: service.id } },
			artist: {
				create: {
					name: `Test Artist ${suffix}`,
					normalizedName: `test artist ${suffix}`,
				},
			},
		},
	})

	// Create an audio file for the track
	await prisma.trackAudioFile.create({
		data: {
			trackId: track.id,
			objectKey: `audio/tracks/local/${track.id}.mp3`,
			fileName: 'test.mp3',
			mimeType: 'audio/mpeg',
			format: 'mp3',
			fileSize: 1024,
		},
	})

	// Create a user playlist owned by kodyuser
	const userPlaylist = await prisma.userPlaylist.create({
		data: {
			title: 'My Download Test Playlist',
			owner: { connect: { id: user!.id } },
		},
	})

	// Add track to the user playlist (NOT to library)
	await prisma.userPlaylistTrack.create({
		data: {
			playlistId: userPlaylist.id,
			trackId: track.id,
			position: 0,
		},
	})

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
