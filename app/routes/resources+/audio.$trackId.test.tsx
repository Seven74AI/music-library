/**
 * @vitest-environment jsdom
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, vi, test, expect } from 'vitest'
import { requireUserId } from '#app/utils/auth.server.js'
import { prisma } from '#app/utils/db.server.js'
import { loader as audioLoader } from './audio.$trackId.tsx'

// Mock the auth — return values set dynamically in each test via vi.mocked
vi.mock('#app/utils/auth.server.ts', () => ({
	requireUserId: vi.fn(),
}))

// Helpers to suppress expected console errors from thrown Responses
function suppressConsoleErrors() {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.spyOn(console, 'warn').mockImplementation(() => {})
}

// Track fixture directories for cleanup (track-specific only — not the whole audio tree)
const fixtureTrackDirs = new Set<string>()

afterAll(() => {
	for (const dir of fixtureTrackDirs) {
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {}
	}
}, 30_000)

/** Create a dummy audio fixture file so the loader can serve it locally (no S3 needed in tests) */
function createAudioFixture(objectKey: string) {
	const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'uploaded', objectKey)
	const dir = fixturePath.substring(0, fixturePath.lastIndexOf('/'))
	mkdirSync(dir, { recursive: true })
	// Write a tiny valid MPEG frame (44 bytes — minimal header)
	writeFileSync(fixturePath, Buffer.from([0xFF, 0xFB, 0x90, 0x00, ...Array(40).fill(0)]))
	// objectKey: audio/tracks/{serviceName}/{trackId}.{ext}
	const trackId = objectKey.split('/')[3]
	if (trackId) {
		fixtureTrackDirs.add(
			join(process.cwd(), 'tests', 'fixtures', 'uploaded', 'audio', 'tracks', 'local', trackId),
		)
	}
}

// Create a fresh set of test entities. Suffix ensures unique names across tests.
let _counter = 0
async function setupTestData() {
	const suffix = `${Date.now()}-${++_counter}`
	const username = `audio-test-${suffix}`

	// Create a unique test user who owns playlists
	const user = await prisma.user.create({
		data: {
			email: `${username}@test.dev`,
			username,
			name: 'Audio Test User',
		},
	})

	// Create a service
	const service = await prisma.service.create({
		data: {
			name: `audio-test-svc-${suffix}`,
			displayName: 'Audio Test Service',
			baseUrl: 'https://test.example.com',
		},
	})

	// Create a track with an audio file
	const track = await prisma.track.create({
		data: {
			title: 'Audio Test Track',
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

	// Create an audio file for the track (needed after access check passes)
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

	// Create local fixture so loader can serve it without S3 config
	createAudioFixture(`audio/tracks/local/${track.id}.mp3`)

	// Create an active service playlist owned by the user
	const playlist = await prisma.servicePlaylist.create({
		data: {
			service: { connect: { id: service.id } },
			externalId: `playlist-ext-${suffix}`,
			title: 'Test Playlist',
			itemCount: 1,
			owner: { connect: { id: user.id } },
			isActive: true,
		},
	})

	return { user, track, playlist }
}

test('200 OK — track is in user library', async () => {
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Add track to user library
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id },
	})

	const response = await audioLoader({
		request: new Request(`https://localhost/resources/audio/${track.id}`),
		params: { trackId: track.id },
		context: {},
	} as any)

	// Access granted — returns 200 (local file) or 302 (remote redirect in MOCKS mode)
	expect([200, 302]).toContain(response.status)
})

test('200 OK — track is in user-owned active service playlist (not in library)', async () => {
	const { user, track, playlist } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Add track to the user's service playlist (NOT to library)
	await prisma.servicePlaylistTrack.create({
		data: {
			playlistId: playlist.id,
			trackId: track.id,
			position: 0,
		},
	})

	const response = await audioLoader({
		request: new Request(`https://localhost/resources/audio/${track.id}`),
		params: { trackId: track.id },
		context: {},
	} as any)

	// Access granted — returns 200 (local file) or 302 (remote redirect in MOCKS mode)
	expect([200, 302]).toContain(response.status)
})

test('200 OK — track is in user-created playlist (not in library or service playlist)', async () => {
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Create a user playlist (not a service playlist)
	const userPlaylist = await prisma.userPlaylist.create({
		data: {
			title: 'My Playlist',
			owner: { connect: { id: user.id } },
		},
	})

	// Add track to the user playlist (NOT to library or service playlist)
	await prisma.userPlaylistTrack.create({
		data: {
			playlistId: userPlaylist.id,
			trackId: track.id,
			position: 0,
		},
	})

	const response = await audioLoader({
		request: new Request(`https://localhost/resources/audio/${track.id}`),
		params: { trackId: track.id },
		context: {},
	} as any)

	// Access granted — returns 200 (local file) or 302 (remote redirect in MOCKS mode)
	expect([200, 302]).toContain(response.status)
})

test('200 OK — track in service playlist PLUS library', async () => {
	const { user, track, playlist } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Add track to BOTH library and service playlist
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id },
	})
	await prisma.servicePlaylistTrack.create({
		data: {
			playlistId: playlist.id,
			trackId: track.id,
			position: 0,
		},
	})

	const response = await audioLoader({
		request: new Request(`https://localhost/resources/audio/${track.id}`),
		params: { trackId: track.id },
		context: {},
	} as any)

	// Access granted — returns 200 (local file) or 302 (remote redirect in MOCKS mode)
	expect([200, 302]).toContain(response.status)
})

test('streams local audio bytes when stream=1', async () => {
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id },
	})

	const response = await audioLoader({
		request: new Request(`https://localhost/resources/audio/${track.id}?stream=1`),
		params: { trackId: track.id },
		context: {},
	} as any)

	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toContain('audio')
	const body = await response.arrayBuffer()
	expect(body.byteLength).toBeGreaterThan(0)
})

test('403 Forbidden — track not in library or any user-owned playlist', async () => {
	suppressConsoleErrors()
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('403 Forbidden — track in service playlist but playlist owner is different user', async () => {
	suppressConsoleErrors()
	const { user, track, playlist } = await setupTestData()

	// Create a different user who owns the playlist
	const suffix = Date.now()
	const otherUser = await prisma.user.create({
		data: {
			email: `other-user-${suffix}@test.dev`,
			username: `other-user-${suffix}`,
			name: 'Other User',
		},
	})

	// Update playlist owner to other user
	await prisma.servicePlaylist.update({
		where: { id: playlist.id },
		data: { owner: { connect: { id: otherUser.id } } },
	})

	// Add track to the playlist (owned by different user)
	await prisma.servicePlaylistTrack.create({
		data: {
			playlistId: playlist.id,
			trackId: track.id,
			position: 0,
		},
	})

	vi.mocked(requireUserId).mockResolvedValue(user.id)

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('403 Forbidden — track in service playlist but playlist is inactive', async () => {
	suppressConsoleErrors()
	const { user, track, playlist } = await setupTestData()

	// Set playlist to inactive
	await prisma.servicePlaylist.update({
		where: { id: playlist.id },
		data: { isActive: false },
	})

	// Add track to the inactive playlist
	await prisma.servicePlaylistTrack.create({
		data: {
			playlistId: playlist.id,
			trackId: track.id,
			position: 0,
		},
	})

	vi.mocked(requireUserId).mockResolvedValue(user.id)

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('403 Forbidden — track in service playlist but playlist track is soft-deleted', async () => {
	suppressConsoleErrors()
	const { user, track, playlist } = await setupTestData()

	// Add track to the playlist but mark as soft-deleted
	await prisma.servicePlaylistTrack.create({
		data: {
			playlistId: playlist.id,
			trackId: track.id,
			position: 0,
			isDeleted: true,
			deletedAt: new Date(),
		},
	})

	vi.mocked(requireUserId).mockResolvedValue(user.id)

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('403 Forbidden — UserTrack is inactive (isActive: false)', async () => {
	suppressConsoleErrors()
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Add track to user library but mark as inactive
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id, isActive: false },
	})

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('403 Forbidden — UserTrack is soft-deleted (deletedAt set)', async () => {
	suppressConsoleErrors()
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Add track to user library but mark as soft-deleted
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id, deletedAt: new Date() },
	})

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(403)
	}
})

test('500 Server Error — objectKey with path traversal rejected', async () => {
	suppressConsoleErrors()
	const { user, track } = await setupTestData()
	vi.mocked(requireUserId).mockResolvedValue(user.id)

	// Add track to user library
	await prisma.userTrack.create({
		data: { userId: user.id, trackId: track.id },
	})

	// Update the audio file's objectKey to contain path traversal
	await prisma.trackAudioFile.updateMany({
		where: { trackId: track.id },
		data: { objectKey: '../../../etc/passwd' },
	})

	try {
		await audioLoader({
			request: new Request(`https://localhost/resources/audio/${track.id}`),
			params: { trackId: track.id },
			context: {},
		} as any)
		expect(true).toBe(false) // Should have thrown
	} catch (error) {
		expect(error).toBeDefined()
		expect((error as any).status).toBe(500)
	}
})
