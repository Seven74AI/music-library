/**
 * Node 25 exposes an experimental `localStorage` global that lacks a working
 * Storage API unless `--localstorage-file` is configured. MSW initializes in
 * setupFiles before jsdom, so patch or replace it before any MSW import.
 */
function createMemoryStorage(): Storage {
	const store = new Map<string, string>()

	return {
		get length() {
			return store.size
		},
		clear() {
			store.clear()
		},
		getItem(key: string) {
			return store.get(key) ?? null
		},
		key(index: number) {
			return [...store.keys()][index] ?? null
		},
		removeItem(key: string) {
			store.delete(key)
		},
		setItem(key: string, value: string) {
			store.set(key, String(value))
		},
	}
}

const storage = createMemoryStorage()

if (
	typeof globalThis.localStorage === 'undefined' ||
	typeof globalThis.localStorage.getItem !== 'function'
) {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: storage,
	})
}
