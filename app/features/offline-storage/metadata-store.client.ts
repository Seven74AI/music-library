import {
	OFFLINE_DB_NAME,
	OFFLINE_DB_VERSION,
	OFFLINE_TRACKS_STORE,
	type OfflineTrackRecord,
	type OfflineTrackSummary,
} from './types.ts'

function openOfflineDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)

		request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
		request.onsuccess = () => resolve(request.result)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(OFFLINE_TRACKS_STORE)) {
				const store = db.createObjectStore(OFFLINE_TRACKS_STORE, {
					keyPath: 'trackId',
				})
				store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
				store.createIndex('isPinned', 'isPinned', { unique: false })
			}
		}
	})
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

export type OfflineMetadataStore = {
	get: (trackId: string) => Promise<OfflineTrackRecord | null>
	put: (record: OfflineTrackRecord) => Promise<void>
	delete: (trackId: string) => Promise<void>
	list: () => Promise<OfflineTrackSummary[]>
	listPinned: () => Promise<OfflineTrackSummary[]>
	listDownloaded: () => Promise<OfflineTrackSummary[]>
	listForPlaylist: (playlistId: string) => Promise<OfflineTrackSummary[]>
	touch: (trackId: string) => Promise<void>
	clear: () => Promise<void>
}

export function createOfflineMetadataStore(): OfflineMetadataStore {
	async function withStore<T>(
		mode: IDBTransactionMode,
		run: (store: IDBObjectStore) => Promise<T> | T,
	): Promise<T> {
		const db = await openOfflineDatabase()
		try {
			const tx = db.transaction(OFFLINE_TRACKS_STORE, mode)
			const store = tx.objectStore(OFFLINE_TRACKS_STORE)
			const result = await run(store)
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve()
				tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'))
				tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
			})
			return result
		} finally {
			db.close()
		}
	}

	function toSummary(record: OfflineTrackRecord): OfflineTrackSummary {
		return {
			trackId: record.trackId,
			title: record.title,
			artistId: record.artistId,
			artistName: record.artistName,
			duration: record.duration,
			coverObjectKey: record.coverObjectKey,
			isPinned: record.isPinned,
			isQueueCached: record.isQueueCached,
			fileSizeBytes: record.fileSizeBytes,
			lastAccessedAt: record.lastAccessedAt,
		}
	}

	return {
		get(trackId) {
			return withStore('readonly', (store) => requestToPromise(store.get(trackId)))
		},
		put(record) {
			return withStore('readwrite', async (store) => {
				await requestToPromise(store.put(record))
			})
		},
		delete(trackId) {
			return withStore('readwrite', (store) => requestToPromise(store.delete(trackId)))
		},
		async list() {
			const records = await withStore('readonly', (store) =>
				requestToPromise(store.getAll()),
			)
			return records.map(toSummary)
		},
		async listPinned() {
			const records = await withStore('readonly', async (store) => {
				const index = store.index('isPinned')
				return requestToPromise(index.getAll(IDBKeyRange.only(true)))
			})
			return records.map(toSummary)
		},
		async listDownloaded() {
			return this.list()
		},
		async listForPlaylist(playlistId) {
			const records = await withStore('readonly', (store) =>
				requestToPromise(store.getAll()),
			)
			return records
				.filter((record) => record.playlistIds.includes(playlistId))
				.map(toSummary)
		},
		async touch(trackId) {
			const existing = await this.get(trackId)
			if (!existing) return
			await this.put({ ...existing, lastAccessedAt: Date.now() })
		},
		clear() {
			return withStore('readwrite', (store) => requestToPromise(store.clear()))
		},
	}
}

let metadataStoreSingleton: OfflineMetadataStore | null = null

export function getOfflineMetadataStore(): OfflineMetadataStore {
	if (!metadataStoreSingleton) {
		metadataStoreSingleton = createOfflineMetadataStore()
	}
	return metadataStoreSingleton
}

export function resetOfflineMetadataStoreForTests() {
	metadataStoreSingleton = null
}
