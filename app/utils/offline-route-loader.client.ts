export function isOfflineEnvironment() {
	return typeof navigator !== 'undefined' && !navigator.onLine
}

function isLikelyNetworkFailure(error: unknown) {
	if (!(error instanceof Error)) return false
	return /failed to fetch|network|load failed|networkerror/i.test(error.message)
}

export async function loadWithOfflineFallback<TOnline, TOffline = TOnline>(
	serverLoader: () => Promise<TOnline>,
	offlineLoader: () => Promise<TOffline>,
): Promise<TOnline | TOffline> {
	try {
		return await serverLoader()
	} catch (error) {
		if (isOfflineEnvironment() || isLikelyNetworkFailure(error)) {
			return offlineLoader()
		}
		throw error
	}
}
