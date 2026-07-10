import { useState } from 'react'
import { toast } from '#app/components/ui/use-toast.ts'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import { useOfflineTrackStatus } from '#app/hooks/use-offline-track-status.ts'
import { type FullTrack } from '#app/types/frontend/shared'

type OfflineTrackDownloadButtonProps = {
	track: Pick<FullTrack, 'id' | 'title' | 'artist' | 'duration' | 'coverImage' | 'audioFiles'>
	size?: 'sm' | 'icon'
}

export function OfflineTrackDownloadButton({
	track,
	size = 'icon',
}: OfflineTrackDownloadButtonProps) {
	const { isDownloaded, isPinned, isBusy, setIsBusy, refresh } =
		useOfflineTrackStatus(track.id)
	const [isWorking, setIsWorking] = useState(false)

	const hasAudio = Boolean(track.audioFiles && track.audioFiles.length > 0)
	if (!hasAudio) return null

	async function handleClick(event: React.MouseEvent) {
		event.preventDefault()
		event.stopPropagation()

		const storage = getOfflineStorage()
		setIsWorking(true)
		setIsBusy(true)

		try {
			if (isDownloaded && isPinned) {
				await storage.removeTrack(track.id)
				toast({ title: 'Removed download', description: track.title })
			} else {
				await storage.downloadTrack(track, { pin: true })
				toast({ title: 'Downloaded for offline', description: track.title })
			}
			await refresh()
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Download failed'
			toast({ title: 'Offline download failed', description: message, variant: 'destructive' })
		} finally {
			setIsWorking(false)
			setIsBusy(false)
		}
	}

	const label =
		isDownloaded && isPinned ? 'Remove offline download' : 'Download for offline'

	return (
		<Button
			type="button"
			size={size}
			variant={isDownloaded && isPinned ? 'secondary' : 'ghost'}
			onClick={(event) => void handleClick(event)}
			disabled={isWorking || isBusy}
			aria-label={label}
			title={label}
		>
			<Icon
				name={isWorking ? 'arrow-path' : isDownloaded && isPinned ? 'check' : 'download'}
				className={`h-4 w-4 ${isWorking ? 'animate-spin' : ''}`}
			/>
		</Button>
	)
}
