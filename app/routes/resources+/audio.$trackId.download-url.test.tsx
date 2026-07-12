/**
 * @vitest-environment jsdom
 */
import { vi, test, expect } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.js'
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

test('403 Forbidden — UserTrack is inactive (isActive: false)', async () => {
	const username = `dl-inactive-${Date.now()}`
	const user = await prisma.user.create({
		data: {
			email: `${username}@test.dev`,
			username,
			name: 'DL Inactive Test',
		},
	})
	const service = await prisma.service.create({
		data: {
			name: `dl-svc-${Date.now()}`,
			displayName: 'DL Test Service',
			baseUrl: 'https://test.example.com',
		},
	})
	const track = await prisma.track.create({
		data: {
			title: 'DL Inactive Track',
			externalId: `ext-dl-inactive-${Date.now()}`,
			service: { connect: { id: service.id } },
			artist: {
				create: {
					name: 'DL Artist',
					normalizedName: 'dl artist',
				},
			},
		},
	})
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
	// Inactive UserTrack
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id, isActive: false },
	})

	vi.mocked(requireUserId).mockResolvedValue(user.id)
	try {
		await downloadUrlLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}/download-url`),
			params: { trackId: track.id },
			context: {},
			url: new URL(`https://localhost/resources/audio/${track.id}/download-url`),
			pattern: { path: '/resources/audio/:trackId/download-url' },
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('403 Forbidden — UserTrack is soft-deleted (deletedAt set)', async () => {
	const username = `dl-deleted-${Date.now()}`
	const user = await prisma.user.create({
		data: {
			email: `${username}@test.dev`,
			username,
			name: 'DL Deleted Test',
		},
	})
	const service = await prisma.service.create({
		data: {
			name: `dl-svc2-${Date.now()}`,
			displayName: 'DL Test Service 2',
			baseUrl: 'https://test.example.com',
		},
	})
	const track = await prisma.track.create({
		data: {
			title: 'DL Soft-Deleted Track',
			externalId: `ext-dl-deleted-${Date.now()}`,
			service: { connect: { id: service.id } },
			artist: {
				create: {
					name: 'DL Artist 2',
					normalizedName: 'dl artist 2',
				},
			},
		},
	})
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
	// Soft-deleted UserTrack
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id, deletedAt: new Date() },
	})

	vi.mocked(requireUserId).mockResolvedValue(user.id)
	try {
		await downloadUrlLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}/download-url`),
			params: { trackId: track.id },
			context: {},
			url: new URL(`https://localhost/resources/audio/${track.id}/download-url`),
			pattern: { path: '/resources/audio/:trackId/download-url' },
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})
