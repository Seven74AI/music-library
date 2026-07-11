import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'

const blobUrlCache = new Map<string, string>()

export async function resolvePlaybackAudioUrl(trackId: string): Promise<string | null> {
	const storage = getOfflineStorage()
	const blob = await storage.resolvePlaybackBlob(trackId)
	if (!blob) return null

	const existing = blobUrlCache.get(trackId)
	if (existing) {
		URL.revokeObjectURL(existing)
	}

	const url = URL.createObjectURL(blob)
	blobUrlCache.set(trackId, url)
	return url
}

export function revokePlaybackAudioUrl(trackId: string) {
	const existing = blobUrlCache.get(trackId)
	if (!existing) return
	URL.revokeObjectURL(existing)
	blobUrlCache.delete(trackId)
}

export async function fetchRemotePlaybackAudioUrl(
	trackId: string,
): Promise<string | null> {
	const response = await fetch(`/resources/audio/${trackId}`)
	if (!response.ok) return null
	const data = (await response.json()) as { url: string }
	return data.url
}

export async function resolveTrackPlaybackSource(
	trackId: string,
	options: { preferOffline?: boolean } = {},
): Promise<string | null> {
	if (options.preferOffline) {
		const offlineUrl = await resolvePlaybackAudioUrl(trackId)
		if (offlineUrl) return offlineUrl
	}

	try {
		const remoteUrl = await fetchRemotePlaybackAudioUrl(trackId)
		if (remoteUrl) return remoteUrl
	} catch {
		// fall through to offline blob
	}

	return resolvePlaybackAudioUrl(trackId)
}
