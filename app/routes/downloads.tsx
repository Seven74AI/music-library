import { Link, useRevalidator } from 'react-router'
import { OfflineTrackDownloadButton } from '#app/components/offline/offline-track-download-button.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { type Route } from './+types/downloads.ts'

export async function clientLoader() {
	const storage = getOfflineStorage()
	const tracks = await storage.listDownloaded()
	return { tracks }
}

clientLoader.hydrate = true

export default function DownloadsRoute({ loaderData }: Route.ComponentProps) {
	const revalidator = useRevalidator()
	const tracks = loaderData.tracks

	return (
		<main className="py-8">
			<div className="mb-6 flex items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold">Downloads</h1>
					<p className="text-muted-foreground mt-2">
						Tracks saved on this device for offline playback.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void revalidator.revalidate()}
				>
					<Icon name="arrow-path" className="mr-2 h-4 w-4" />
					Refresh
				</Button>
			</div>

			{tracks.length === 0 ? (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<p className="text-muted-foreground">
						No offline tracks yet. Download tracks from your library or playlists while
						online.
					</p>
					<Button asChild className="mt-4">
						<Link to="/library">Browse library</Link>
					</Button>
				</div>
			) : (
				<ul className="divide-y rounded-lg border">
					{tracks.map((track) => (
						<li
							key={track.trackId}
							className="flex items-center justify-between gap-4 px-4 py-3"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{track.title}</p>
								<p className="text-muted-foreground truncate text-sm">
									{track.artistName}
									{track.duration ? ` · ${formatDuration(track.duration)}` : ''}
								</p>
								<p className="text-muted-foreground mt-1 text-xs">
									{track.isPinned ? 'Pinned download' : 'Queue cache'}
								</p>
							</div>
							<OfflineTrackDownloadButton
								track={{
									id: track.trackId,
									title: track.title,
									artist: { id: track.artistId, name: track.artistName },
									duration: track.duration,
									coverImage: track.coverObjectKey
										? { objectKey: track.coverObjectKey }
										: null,
									audioFiles: [{ id: track.trackId, format: 'mp3', objectKey: '' }],
								}}
							/>
						</li>
					))}
				</ul>
			)}
		</main>
	)
}
