const SW_URL = '/sw.js'

export function registerServiceWorker() {
	if (
		typeof window === 'undefined' ||
		!('serviceWorker' in navigator) ||
		window.ENV?.DISABLE_SERVICE_WORKER === 'true'
	) {
		return
	}

	void navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch((error) => {
		console.warn('Service worker registration failed:', error)
	})
}
