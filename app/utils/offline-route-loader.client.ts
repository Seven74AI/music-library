export function isOfflineEnvironment() {
	return typeof navigator !== 'undefined' && !navigator.onLine
}

function isLikelyNetworkFailure(error: unknown) {
	if (error instanceof TypeError) return true
	if (error instanceof Error) {
		return /failed to fetch|network|load failed|networkerror/i.test(error.message)
	}
	return false
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
		if (isOfflineEnvironment() || isLikelyNetworkFailure(error)) {
			return offlineLoader()
		}
		throw error
	}
}
