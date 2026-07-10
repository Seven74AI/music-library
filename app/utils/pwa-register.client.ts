const SW_URL = '/sw.js'

export function registerServiceWorker() {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
		return
	}

	void navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch((error) => {
		console.warn('Service worker registration failed:', error)
	})
}
