import { useCallback, useEffect, useState } from 'react'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'

export function useOfflineTrackStatus(trackId: string | null) {
	const [isDownloaded, setIsDownloaded] = useState(false)
	const [isPinned, setIsPinned] = useState(false)
	const [isBusy, setIsBusy] = useState(false)

	const refresh = useCallback(async () => {
		if (!trackId) {
			setIsDownloaded(false)
			setIsPinned(false)
			return
		}
		const storage = getOfflineStorage()
		const record = await storage.getRecord(trackId)
		setIsDownloaded(Boolean(record))
		setIsPinned(Boolean(record?.isPinned))
	}, [trackId])

	useEffect(() => {
		void refresh()
	}, [refresh])

	return {
		isDownloaded,
		isPinned,
		isBusy,
		setIsBusy,
		refresh,
	}
}
