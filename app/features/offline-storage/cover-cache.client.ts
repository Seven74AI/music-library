import {
	OFFLINE_COVERS_STORE,
	OFFLINE_DB_NAME,
	OFFLINE_DB_VERSION,
} from './types.ts'

const coverUrlCache = new Map<string, string>()

function openOfflineDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
		request.onsuccess = () => resolve(request.result)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains('tracks')) {
				const store = db.createObjectStore('tracks', { keyPath: 'trackId' })
				store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
				store.createIndex('isPinned', 'isPinned', { unique: false })
			}
			if (!db.objectStoreNames.contains(OFFLINE_COVERS_STORE)) {
				db.createObjectStore(OFFLINE_COVERS_STORE, { keyPath: 'objectKey' })
			}
		}
	})
}

export async function cacheCoverImage(objectKey: string, bytes: ArrayBuffer) {
	const db = await openOfflineDatabase()
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(OFFLINE_COVERS_STORE, 'readwrite')
			const store = tx.objectStore(OFFLINE_COVERS_STORE)
			store.put({ objectKey, bytes, mimeType: 'image/webp' })
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error ?? new Error('cover cache write failed'))
		})
	} finally {
		db.close()
	}
}

export async function readCachedCoverBlob(objectKey: string): Promise<Blob | null> {
	const db = await openOfflineDatabase()
	try {
		const record = await new Promise<{ bytes: ArrayBuffer; mimeType: string } | undefined>(
			(resolve, reject) => {
				const tx = db.transaction(OFFLINE_COVERS_STORE, 'readonly')
				const request = tx.objectStore(OFFLINE_COVERS_STORE).get(objectKey)
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error ?? new Error('cover cache read failed'))
			},
		)

		if (!record?.bytes) return null
		return new Blob([record.bytes], { type: record.mimeType || 'image/webp' })
	} finally {
		db.close()
	}
}

export async function resolveCachedCoverUrl(objectKey: string): Promise<string | null> {
	const cached = coverUrlCache.get(objectKey)
	if (cached) return cached

	const blob = await readCachedCoverBlob(objectKey)
	if (!blob) return null

	const url = URL.createObjectURL(blob)
	coverUrlCache.set(objectKey, url)
	return url
}

export function revokeCachedCoverUrl(objectKey: string) {
	const existing = coverUrlCache.get(objectKey)
	if (!existing) return
	URL.revokeObjectURL(existing)
	coverUrlCache.delete(objectKey)
}

export async function deleteCachedCover(objectKey: string) {
	revokeCachedCoverUrl(objectKey)
	const db = await openOfflineDatabase()
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(OFFLINE_COVERS_STORE, 'readwrite')
			tx.objectStore(OFFLINE_COVERS_STORE).delete(objectKey)
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error ?? new Error('cover cache delete failed'))
		})
	} finally {
		db.close()
	}
}
