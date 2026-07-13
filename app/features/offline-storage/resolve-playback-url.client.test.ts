import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ── Mock factories ──────────────────────────────────────────────────────────
const mockResolvePlaybackBlob = vi.fn()
const mockGetOfflineStorage = vi.fn(() => ({
	resolvePlaybackBlob: mockResolvePlaybackBlob,
}))

// ── Dynamically imported module references ─────────────────────────────────
let resolveTrackPlaybackSource: (
	trackId: string,
	options?: { preferOffline?: boolean },
) => Promise<string | null>
let resolvePlaybackAudioUrl: (trackId: string) => Promise<string | null>
let fetchRemotePlaybackAudioUrl: (trackId: string) => Promise<string | null>
let revokePlaybackAudioUrl: (trackId: string) => void
let mockCreateObjectURL: ReturnType<typeof vi.fn>
let mockRevokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(async () => {
	vi.resetModules()

	mockResolvePlaybackBlob.mockReset()
	mockGetOfflineStorage.mockReset()
	mockGetOfflineStorage.mockReturnValue({
		resolvePlaybackBlob: mockResolvePlaybackBlob,
	})

	vi.doMock(
		'#app/features/offline-storage/offline-storage.client.ts',
		() => ({
			getOfflineStorage: mockGetOfflineStorage,
		}),
	)

	const mod = await import('./resolve-playback-url.client.ts')
	resolveTrackPlaybackSource = mod.resolveTrackPlaybackSource
	resolvePlaybackAudioUrl = mod.resolvePlaybackAudioUrl
	fetchRemotePlaybackAudioUrl = mod.fetchRemotePlaybackAudioUrl
	revokePlaybackAudioUrl = mod.revokePlaybackAudioUrl

	// Stub URL.createObjectURL / revokeObjectURL for deterministic tests
	mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url')
	mockRevokeObjectURL = vi.fn()
	vi.stubGlobal('URL', {
		createObjectURL: mockCreateObjectURL,
		revokeObjectURL: mockRevokeObjectURL,
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// ── Helpers ─────────────────────────────────────────────────────────────────
function stubFetchOk(url: string) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ url }),
		}),
	)
}

function stubFetchNotOk(status = 404) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: false,
			status,
		}),
	)
}

function stubFetchError(error = new TypeError('Failed to fetch')) {
	vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
}

function stubNavigatorOnline(value: boolean) {
	vi.stubGlobal('navigator', { onLine: value })
}

function blob(): Blob {
	return new Blob(['audio'], { type: 'audio/mpeg' })
}

// ═════════════════════════════════════════════════════════════════════════════
// resolveTrackPlaybackSource
// ═════════════════════════════════════════════════════════════════════════════
describe('resolveTrackPlaybackSource', () => {
	// ── Existing tests (F1‑era) ──────────────────────────────────────────

	test('tries remote playback even when navigator reports offline', async () => {
		stubNavigatorOnline(false)
		stubFetchOk('https://cdn.example/track-1.mp3')
		mockResolvePlaybackBlob.mockResolvedValue(null)

		await expect(
			resolveTrackPlaybackSource('track-1'),
		).resolves.toBe('https://cdn.example/track-1.mp3')
	})

	test('falls back to offline blob when remote playback fails', async () => {
		stubNavigatorOnline(false)
		stubFetchError()
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		await expect(
			resolveTrackPlaybackSource('track-1'),
		).resolves.toMatch(/^blob:/)
	})

	// ── F7#1: preferOffline path ─────────────────────────────────────────

	test('preferOffline returns blob URL immediately when offline store has blob', async () => {
		mockResolvePlaybackBlob.mockResolvedValue(blob())
		// fetch should NOT be called — stub to throw so we catch accidental calls
		stubFetchError(new Error('fetch should not have been called'))

		const result = await resolveTrackPlaybackSource('track-1', {
			preferOffline: true,
		})

		expect(result).toMatch(/^blob:/)
		expect(result).toBe('blob:mock-url')
	})

	test('preferOffline falls through to remote when offline store has no blob', async () => {
		mockResolvePlaybackBlob.mockResolvedValue(null)
		stubFetchOk('https://cdn.example/track-1.mp3')

		const result = await resolveTrackPlaybackSource('track-1', {
			preferOffline: true,
		})

		expect(result).toBe('https://cdn.example/track-1.mp3')
	})

	test('preferOffline falls through to remote, then offline when both first two fail', async () => {
		// First call (preferOffline): resolvePlaybackBlob → null
		// Second call (fallback at end): resolvePlaybackBlob → blob
		mockResolvePlaybackBlob.mockResolvedValueOnce(null) // preferOffline check
		stubFetchError() // remote fetch throws
		mockResolvePlaybackBlob.mockResolvedValueOnce(blob()) // final fallback

		const result = await resolveTrackPlaybackSource('track-1', {
			preferOffline: true,
		})

		expect(result).toMatch(/^blob:/)
	})

	// ── F7#2: Remote fetch non‑ok → fallback to offline ──────────────────

	test('falls back to offline when remote fetch returns 404', async () => {
		stubFetchNotOk(404)
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		const result = await resolveTrackPlaybackSource('track-1')

		expect(result).toMatch(/^blob:/)
	})

	test('falls back to offline when remote fetch returns 403', async () => {
		stubFetchNotOk(403)
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		const result = await resolveTrackPlaybackSource('track-1')

		expect(result).toMatch(/^blob:/)
	})

	// ── F7#3: Both remote and offline fail → null ────────────────────────

	test('returns null when both remote fetch and offline blob fail', async () => {
		stubFetchError()
		// both calls to resolvePlaybackBlob return null
		// (first: in the fallback path at end of function)
		mockResolvePlaybackBlob.mockResolvedValue(null)

		const result = await resolveTrackPlaybackSource('track-1')

		expect(result).toBeNull()
	})

	// ── F7#8: Online but offline store has blob → remote tried first ────

	test('returns remote URL when online and remote succeeds, even with offline blob available', async () => {
		stubNavigatorOnline(true)
		stubFetchOk('https://cdn.example/track-1.mp3')
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		const result = await resolveTrackPlaybackSource('track-1')

		// remote is tried first (no preferOffline), so remote URL should win
		expect(result).toBe('https://cdn.example/track-1.mp3')
	})

	test('falls back to offline when online but remote fetch fails', async () => {
		stubNavigatorOnline(true)
		stubFetchError()
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		const result = await resolveTrackPlaybackSource('track-1')

		expect(result).toMatch(/^blob:/)
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// fetchRemotePlaybackAudioUrl — F7#5: isolation tests
// ═════════════════════════════════════════════════════════════════════════════
describe('fetchRemotePlaybackAudioUrl', () => {
	test('returns URL when fetch response is ok', async () => {
		stubFetchOk('https://cdn.example/track-99.mp3')

		const result = await fetchRemotePlaybackAudioUrl('track-99')

		expect(result).toBe('https://cdn.example/track-99.mp3')
	})

	test('returns null when fetch response is 404', async () => {
		stubFetchNotOk(404)

		const result = await fetchRemotePlaybackAudioUrl('track-missing')

		expect(result).toBeNull()
	})

	test('returns null when fetch response is 500', async () => {
		stubFetchNotOk(500)

		const result = await fetchRemotePlaybackAudioUrl('track-error')

		expect(result).toBeNull()
	})

	test('throws when fetch rejects (network error propagates to caller)', async () => {
		stubFetchError()

		await expect(
			fetchRemotePlaybackAudioUrl('track-offline'),
		).rejects.toThrow('Failed to fetch')
	})

	test('calls fetch with correct endpoint', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ url: 'https://cdn.example/t.mp3' }),
		})
		vi.stubGlobal('fetch', fetchSpy)

		await fetchRemotePlaybackAudioUrl('abc-123')

		expect(fetchSpy).toHaveBeenCalledWith('/resources/audio/abc-123')
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// resolvePlaybackAudioUrl — F7#4: isolation tests
// ═════════════════════════════════════════════════════════════════════════════
describe('resolvePlaybackAudioUrl', () => {
	test('returns blob URL when offline store has blob', async () => {
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		const result = await resolvePlaybackAudioUrl('track-1')

		expect(result).toBe('blob:mock-url')
		expect(mockCreateObjectURL).toHaveBeenCalledTimes(1)
	})

	test('returns null when offline store has no blob', async () => {
		mockResolvePlaybackBlob.mockResolvedValue(null)

		const result = await resolvePlaybackAudioUrl('track-missing')

		expect(result).toBeNull()
		expect(mockCreateObjectURL).not.toHaveBeenCalled()
	})

	test('creates object URL from the returned blob', async () => {
		const audioBlob = blob()
		mockResolvePlaybackBlob.mockResolvedValue(audioBlob)

		await resolvePlaybackAudioUrl('track-1')

		expect(mockCreateObjectURL).toHaveBeenCalledWith(audioBlob)
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// revokePlaybackAudioUrl — F7#6: isolation tests
// ═════════════════════════════════════════════════════════════════════════════
describe('revokePlaybackAudioUrl', () => {
	test('revokes cached blob URL for known track', async () => {
		// First, populate the cache via resolvePlaybackAudioUrl
		mockResolvePlaybackBlob.mockResolvedValue(blob())
		await resolvePlaybackAudioUrl('track-1')
		// Cache now has 'blob:mock-url' for track-1

		// Reset call counters
		mockRevokeObjectURL.mockClear()

		revokePlaybackAudioUrl('track-1')

		expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
	})

	test('is a no‑op for unknown track', () => {
		revokePlaybackAudioUrl('track-nonexistent')

		expect(mockRevokeObjectURL).not.toHaveBeenCalled()
	})

	test('clears cache so subsequent resolve creates fresh URL', async () => {
		// Populate cache
		mockResolvePlaybackBlob.mockResolvedValue(blob())
		await resolvePlaybackAudioUrl('track-1')
		// Cache: track-1 → blob:mock-url

		// Revoke
		revokePlaybackAudioUrl('track-1')
		expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

		// Resolve again — should create a new URL, NOT revoke old
		mockRevokeObjectURL.mockClear()
		mockResolvePlaybackBlob.mockResolvedValue(blob())
		await resolvePlaybackAudioUrl('track-1')

		expect(mockRevokeObjectURL).not.toHaveBeenCalled()
		expect(mockCreateObjectURL).toHaveBeenCalledTimes(2) // once in each resolve
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// Blob URL cache — F7#7: old URL revoked before new one created
// ═════════════════════════════════════════════════════════════════════════════
describe('blob URL cache', () => {
	test('revokes old blob URL before creating new one for same track', async () => {
		mockResolvePlaybackBlob.mockResolvedValue(blob())

		// First resolution: caches 'blob:mock-url'
		await resolvePlaybackAudioUrl('track-1')

		// Set up second resolution: different return value
		mockCreateObjectURL.mockReturnValue('blob:mock-url-2')

		const callOrder: string[] = []
		mockRevokeObjectURL.mockImplementation(() => callOrder.push('revoke'))
		mockCreateObjectURL.mockImplementation(() => {
			callOrder.push('create')
			return 'blob:mock-url-2'
		})

		// Reset mock state so we only see second-call behavior
		// Actually, let's just check invocation order directly
		mockRevokeObjectURL.mockClear()
		mockCreateObjectURL.mockClear()

		// Second resolution: should revoke old then create new
		mockResolvePlaybackBlob.mockResolvedValue(blob())
		const result = await resolvePlaybackAudioUrl('track-1')

		expect(result).toBe('blob:mock-url-2')
		expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
		expect(mockCreateObjectURL).toHaveBeenCalled()

		// Verify revoke happened before create
		const revokeCallIdx =
			mockRevokeObjectURL.mock.invocationCallOrder[0]!
		const createCallIdx =
			mockCreateObjectURL.mock.invocationCallOrder[0]!
		expect(revokeCallIdx).toBeLessThan(createCallIdx)
	})
})
