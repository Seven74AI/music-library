import { type FullTrack } from '#app/types/frontend/shared'
import { coverImageUrl, trackThumbnailPixelSizes } from '#app/utils/cover-image-url.ts'
import { cacheCoverImage } from './cover-cache.client.ts'
import {
	createMemoryOfflineAudioStore,
	type OfflineAudioStore,
} from './memory-audio-store.ts'
import { getOfflineMetadataStore } from './metadata-store.client.ts'
import { offlineAudioOpfsPath } from './offline-audio-path.ts'
import { getOfflineAudioFormat, mimeTypeForAudioFormat } from './offline-track-summary.client.ts'
import {
	createOpfsOfflineAudioStore,
	isOpfsAudioStoreSupported,
} from './opfs-audio-store.client.ts'
import {
	selectQueueCacheEvictionCandidates,
} from './pin-policy.ts'
import {
	mergeOfflineTrackRecord,
	toOfflineTrackRecord,
	type OfflineTrackRecord,
	type OfflineTrackSummary,
} from './types.ts'

const DEFAULT_QUOTA_HEADROOM_BYTES = 50 * 1024 * 1024

export type OfflineStorageStats = {
	trackCount: number
	pinnedCount: number
	totalBytes: number
	usage: number
	quota: number
}

export type OfflineStorage = {
	downloadTrack: (
		track: FullTrack,
		options?: {
			pin?: boolean
			playlistId?: string
			onProgress?: (progress: { completed: number; total: number }) => void
		},
	) => Promise<void>
	cacheQueueTrack: (track: FullTrack) => Promise<void>
	removeTrack: (trackId: string) => Promise<void>
	resolvePlaybackBlob: (trackId: string) => Promise<Blob | null>
	hasTrack: (trackId: string) => Promise<boolean>
	listDownloaded: () => Promise<OfflineTrackSummary[]>
	listPinned: () => Promise<OfflineTrackSummary[]>
	listForPlaylist: (playlistId: string) => Promise<OfflineTrackSummary[]>
	getRecord: (trackId: string) => Promise<OfflineTrackRecord | null>
	getStorageStats: () => Promise<OfflineStorageStats>
}

export type OfflineStorageDependencies = {
	audioStore: OfflineAudioStore
	metadataStore: ReturnType<typeof getOfflineMetadataStore>
	fetchAudioBytes: (trackId: string) => Promise<ArrayBuffer>
	requestPersistentStorage: () => Promise<void>
	readStorageEstimate: () => Promise<{ usage: number; quota: number }>
}

async function defaultFetchAudioBytes(trackId: string): Promise<ArrayBuffer> {
	const audioResponse = await fetch(`/resources/audio/${trackId}?stream=1`, {
		credentials: 'same-origin',
	})
	if (!audioResponse.ok) {
		throw new Error(`Failed to download audio for ${trackId}`)
	}
	return audioResponse.arrayBuffer()
}

async function defaultRequestPersistentStorage() {
	if ('storage' in navigator && 'persist' in navigator.storage) {
		await navigator.storage.persist()
	}
}

async function defaultReadStorageEstimate() {
	if ('storage' in navigator && 'estimate' in navigator.storage) {
		const estimate = await navigator.storage.estimate()
		return {
			usage: estimate.usage ?? 0,
			quota: estimate.quota ?? 0,
		}
	}
	return { usage: 0, quota: 0 }
}

export function createOfflineStorage(
	deps: Partial<OfflineStorageDependencies> = {},
): OfflineStorage {
	const audioStore = deps.audioStore ?? createDefaultAudioStore()
	const metadataStore = deps.metadataStore ?? getOfflineMetadataStore()
	const fetchAudioBytes = deps.fetchAudioBytes ?? defaultFetchAudioBytes
	const requestPersistentStorage =
		deps.requestPersistentStorage ?? defaultRequestPersistentStorage
	const readStorageEstimate = deps.readStorageEstimate ?? defaultReadStorageEstimate

	async function ensureCapacity(requiredBytes: number) {
		const { usage, quota } = await readStorageEstimate()
		if (!quota) return

		const available = quota - usage
		if (available >= requiredBytes + DEFAULT_QUOTA_HEADROOM_BYTES) return

		const allRecords = await metadataStore.list()
		const fullRecords = await Promise.all(
			allRecords.map(async (summary) => metadataStore.get(summary.trackId)),
		)
		const records = fullRecords.filter(
			(record): record is OfflineTrackRecord => record !== null,
		)

		const bytesToFree =
			requiredBytes + DEFAULT_QUOTA_HEADROOM_BYTES - available
		const victims = selectQueueCacheEvictionCandidates(records, bytesToFree)

		for (const victim of victims) {
			await audioStore.delete(victim.trackId)
			await metadataStore.delete(victim.trackId)
		}
	}

	async function cacheTrackCover(track: FullTrack) {
		const objectKey = track.coverImage?.objectKey
		if (!objectKey) return

		const response = await fetch(
			coverImageUrl(objectKey, trackThumbnailPixelSizes.sm),
			{ credentials: 'same-origin' },
		)
		if (!response.ok) return
		await cacheCoverImage(objectKey, await response.arrayBuffer())
	}

	async function storeTrack(
		track: FullTrack,
		buffer: ArrayBuffer,
		options: { pin: boolean; queue: boolean; playlistId?: string },
	) {
		const fileSizeBytes = buffer.byteLength
		await requestPersistentStorage()
		await ensureCapacity(fileSizeBytes)

		const existing = await metadataStore.get(track.id)
		await audioStore.write(track.id, buffer)

		if (existing) {
			await metadataStore.put(
				mergeOfflineTrackRecord(existing, {
					isPinned: options.pin ? true : existing.isPinned,
					isQueueCached: options.queue ? true : existing.isQueueCached,
					fileSizeBytes,
					lastAccessedAt: Date.now(),
					pinnedAt: options.pin ? Date.now() : existing.pinnedAt,
					playlistId: options.playlistId,
					audioFormat: getOfflineAudioFormat(track),
				}),
			)
			return
		}

		await metadataStore.put(
			toOfflineTrackRecord(track, {
				opfsPath: offlineAudioOpfsPath(track.id),
				fileSizeBytes,
				isPinned: options.pin,
				isQueueCached: options.queue,
				playlistId: options.playlistId,
				audioFormat: getOfflineAudioFormat(track),
			}),
		)
	}

	return {
		async downloadTrack(track, options = {}) {
			const pin = options.pin ?? true
			const buffer = await fetchAudioBytes(track.id)
			await storeTrack(track, buffer, {
				pin,
				queue: !pin,
				playlistId: options.playlistId,
			})
			try {
				await cacheTrackCover(track)
			} catch {
				// Cover caching is best-effort
			}
			options.onProgress?.({ completed: 1, total: 1 })
		},
		async cacheQueueTrack(track) {
			if (await metadataStore.get(track.id)) {
				await metadataStore.touch(track.id)
				return
			}
			const buffer = await fetchAudioBytes(track.id)
			await storeTrack(track, buffer, { pin: false, queue: true })
		},
		async removeTrack(trackId) {
			const record = await metadataStore.get(trackId)
			await audioStore.delete(trackId)
			await metadataStore.delete(trackId)
			if (record?.coverObjectKey) {
				const { deleteCachedCover } = await import('./cover-cache.client.ts')
				await deleteCachedCover(record.coverObjectKey)
			}
		},
		async resolvePlaybackBlob(trackId) {
			const record = await metadataStore.get(trackId)
			if (!record) return null
			const buffer = await audioStore.read(trackId)
			if (!buffer) {
				await metadataStore.delete(trackId)
				return null
			}
			await metadataStore.touch(trackId)
			return new Blob([buffer], {
				type: mimeTypeForAudioFormat(record.audioFormat),
			})
		},
		async hasTrack(trackId) {
			const record = await metadataStore.get(trackId)
			if (!record) return false
			const exists = await audioStore.has(trackId)
			if (!exists) {
				await metadataStore.delete(trackId)
				return false
			}
			return true
		},
		listDownloaded() {
			return metadataStore.listDownloaded()
		},
		listPinned() {
			return metadataStore.listPinned()
		},
		listForPlaylist(playlistId) {
			return metadataStore.listForPlaylist(playlistId)
		},
		getRecord(trackId) {
			return metadataStore.get(trackId)
		},
		async getStorageStats() {
			const tracks = await metadataStore.list()
			const { usage, quota } = await readStorageEstimate()
			return {
				trackCount: tracks.length,
				pinnedCount: tracks.filter((track) => track.isPinned).length,
				totalBytes: tracks.reduce((sum, track) => sum + track.fileSizeBytes, 0),
				usage,
				quota,
			}
		},
	}
}

function createDefaultAudioStore(): OfflineAudioStore {
	if (isOpfsAudioStoreSupported()) {
		return createOpfsOfflineAudioStore()
	}
	if (import.meta.env.DEV) {
		console.warn('OPFS unavailable — using in-memory offline audio store in dev')
		return createMemoryOfflineAudioStore()
	}
	throw new Error('Offline audio storage is not supported in this browser')
}

let offlineStorageSingleton: OfflineStorage | null = null

export function getOfflineStorage(): OfflineStorage {
	if (!offlineStorageSingleton) {
		offlineStorageSingleton = createOfflineStorage()
	}
	return offlineStorageSingleton
}

export function resetOfflineStorageForTests() {
	offlineStorageSingleton = null
}
