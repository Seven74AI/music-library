type IOSNavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>

type ShareNavigatorLike = IOSNavigatorLike &
	Pick<Navigator, 'share' | 'canShare'>

type TriggerBlobDownloadOptions = {
	navigatorLike?: ShareNavigatorLike
}

export function isIOSDevice(navigatorLike: IOSNavigatorLike = navigator): boolean {
	return (
		/iPad|iPhone|iPod/.test(navigatorLike.userAgent) ||
		(navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1)
	)
}

export async function triggerBrowserDownload(url: string, filename: string): Promise<void> {
	const response = await fetch(url, { credentials: 'same-origin' })
	if (!response.ok) {
		throw new Error(`Download failed: ${response.status}`)
	}

	const blob = await response.blob()
	await triggerBlobDownload(blob, filename)
}

export async function triggerBlobDownload(
	blob: Blob,
	filename: string,
	options: TriggerBlobDownloadOptions = {},
): Promise<void> {
	const navigatorLike = options.navigatorLike ?? navigator
	const file = new File([blob], filename, {
		type: blob.type || 'application/octet-stream',
	})

	if (
		isIOSDevice(navigatorLike) &&
		typeof navigatorLike.share === 'function' &&
		typeof navigatorLike.canShare === 'function' &&
		navigatorLike.canShare({ files: [file] })
	) {
		try {
			await navigatorLike.share({ files: [file] })
			return
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return
			}
		}
	}

	const blobUrl = URL.createObjectURL(blob)
	try {
		const link = document.createElement('a')
		link.href = blobUrl
		link.download = filename
		link.rel = 'noopener'
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
	} finally {
		URL.revokeObjectURL(blobUrl)
	}
}

/**
 * @deprecated Use triggerBrowserDownload for cross-platform downloads.
 */
export function downloadFile(url: string, filename?: string) {
	const link = document.createElement('a')
	link.href = url
	link.download = filename || 'download'
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
}
