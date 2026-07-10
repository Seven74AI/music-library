export function isOfflineEnvironment() {
	return typeof navigator !== 'undefined' && !navigator.onLine
}

export async function loadWithOfflineFallback<TOnline, TOffline = TOnline>(
	serverLoader: () => Promise<TOnline>,
	offlineLoader: () => Promise<TOffline>,
): Promise<TOnline | TOffline> {
	if (isOfflineEnvironment()) {
		return offlineLoader()
	}

	try {
		return await serverLoader()
	} catch (error) {
		if (!isOfflineEnvironment()) throw error
		return offlineLoader()
	}
}
