/**
 * @vitest-environment jsdom
 */
import { vi, test, expect } from 'vitest'
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
			objectKey: `audio/tracks/${track.id}/local/mp3/99-test.mp3`,
			fileName: 'test.mp3',
			mimeType: 'audio/mpeg',
			format: 'mp3',
			fileSize: 1024,
		},
	})

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
