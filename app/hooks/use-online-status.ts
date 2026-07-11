import { useEffect, useState } from 'react'

export function useOnlineStatus() {
	// Assume online until mount — navigator.onLine can be stale before hydration
	// and may recover without firing an "online" event.
	const [isOnline, setIsOnline] = useState(true)

	useEffect(() => {
		setIsOnline(navigator.onLine)

		const goOnline = () => setIsOnline(true)
		const goOffline = () => setIsOnline(false)
		window.addEventListener('online', goOnline)
		window.addEventListener('offline', goOffline)
		return () => {
			window.removeEventListener('online', goOnline)
			window.removeEventListener('offline', goOffline)
		}
	}, [])

	return isOnline
}
