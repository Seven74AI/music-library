import { useEffect, useState } from 'react'
import { resolveCachedCoverUrl } from '#app/features/offline-storage/cover-cache.client.ts'
import { useOnlineStatus } from '#app/hooks/use-online-status.ts'
import { coverImageUrl } from '#app/utils/cover-image-url.ts'

export function useOfflineCoverUrl(
	objectKey: string | null | undefined,
	pixelSize: number,
) {
	const isOnline = useOnlineStatus()
	const [url, setUrl] = useState<string | null>(
		objectKey && isOnline ? coverImageUrl(objectKey, pixelSize) : null,
	)

	useEffect(() => {
		if (!objectKey) {
			setUrl(null)
			return
		}

		if (isOnline) {
			setUrl(coverImageUrl(objectKey, pixelSize))
			return
		}

		let cancelled = false
		void resolveCachedCoverUrl(objectKey).then((cachedUrl) => {
			if (!cancelled) setUrl(cachedUrl)
		})

		return () => {
			cancelled = true
		}
	}, [objectKey, isOnline, pixelSize])

	return url
}
