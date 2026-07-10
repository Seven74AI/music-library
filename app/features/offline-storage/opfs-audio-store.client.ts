import { type OfflineAudioStore } from './memory-audio-store.ts'

type WorkerRequest = {
	type: string
	trackId: string
	buffer?: ArrayBuffer
}

type WorkerResponse =
	| { id: number; ok: true; buffer?: ArrayBuffer; exists?: boolean }
	| { id: number; ok: false; error: string }

export function createOpfsOfflineAudioStore(): OfflineAudioStore {
	const worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), {
		type: 'module',
	})

	let nextId = 1
	const pending = new Map<
		number,
		{
			resolve: (value: WorkerResponse) => void
			reject: (reason?: unknown) => void
		}
	>()

	worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
		const response = event.data
		const handlers = pending.get(response.id)
		if (!handlers) return
		pending.delete(response.id)
		if (response.ok) {
			handlers.resolve(response)
		} else {
			handlers.reject(new Error(response.error))
		}
	})

	function callWorker(message: WorkerRequest): Promise<WorkerResponse> {
		const id = nextId++
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject })
			worker.postMessage({ ...message, id }, message.buffer ? [message.buffer] : [])
		})
	}

	return {
		async write(trackId, data) {
			const response = await callWorker({ type: 'write', trackId, buffer: data })
			if (!response.ok) throw new Error('write failed')
		},
		async read(trackId) {
			const response = await callWorker({ type: 'read', trackId })
			if (!response.ok) throw new Error('read failed')
			return response.buffer ?? null
		},
		async delete(trackId) {
			const response = await callWorker({ type: 'delete', trackId })
			if (!response.ok) throw new Error('delete failed')
		},
		async has(trackId) {
			const response = await callWorker({ type: 'has', trackId })
			if (!response.ok) throw new Error('has failed')
			return Boolean(response.exists)
		},
	}
}

export function isOpfsAudioStoreSupported(): boolean {
	return (
		typeof Worker !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		'storage' in navigator &&
		typeof navigator.storage.getDirectory === 'function'
	)
}
