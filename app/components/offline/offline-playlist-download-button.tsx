import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { toast } from '#app/components/ui/use-toast.ts'
import { cachePlaylistMetadata } from '#app/features/offline-storage/offline-playlist-metadata.client.ts'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import { type FullTrack } from '#app/types/frontend/shared'
import { filterPlayableTracks } from '#app/utils/playable-track.ts'

type OfflinePlaylistDownloadButtonProps = {
	playlistId: string
	title: string
	description: string | null
	tracks: FullTrack[]
}

export function OfflinePlaylistDownloadButton({
	playlistId,
	title,
	description,
	tracks,
}: OfflinePlaylistDownloadButtonProps) {
	const [isWorking, setIsWorking] = useState(false)
	const [progress, setProgress] = useState<{ completed: number; total: number } | null>(
		null,
	)
	const playableTracks = filterPlayableTracks(tracks)

	if (playableTracks.length === 0) return null

	async function handleDownload() {
		setIsWorking(true)
		const storage = getOfflineStorage()

		try {
			cachePlaylistMetadata({
				id: playlistId,
				title,
				description,
				updatedAt: Date.now(),
			})

			let downloaded = 0
			for (const track of playableTracks) {
				await storage.downloadTrack(track, { pin: true, playlistId })
				downloaded += 1
				setProgress({ completed: downloaded, total: playableTracks.length })
			}

			toast({
				title: 'Playlist downloaded',
				description: `${downloaded} track${downloaded === 1 ? '' : 's'} saved for offline listening.`,
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Download failed'
			toast({
				title: 'Playlist download failed',
				description: message,
				variant: 'destructive',
			})
		} finally {
			setIsWorking(false)
			setProgress(null)
		}
	}

	const label =
		isWorking && progress
			? `Downloading ${progress.completed}/${progress.total}`
			: 'Download playlist'

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => void handleDownload()}
			disabled={isWorking}
			aria-label={label}
		>
			<Icon
				name={isWorking ? 'arrow-path' : 'download'}
				className={`mr-2 h-4 w-4 ${isWorking ? 'animate-spin' : ''}`}
			/>
			{label}
		</Button>
	)
}
