import { Link } from 'react-router'
import { OfflineTrackDownloadButton } from '#app/components/offline/offline-track-download-button.tsx'
import { TrackListItem } from '#app/components/track-list-item.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { type OfflineTrackSummary } from '#app/features/offline-storage/types.ts'

type OfflineLibraryViewProps = {
	tracks: OfflineTrackSummary[]
}

export function OfflineLibraryView({ tracks }: OfflineLibraryViewProps) {
	if (tracks.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-10 text-center">
				<p className="text-muted-foreground">
					No downloaded tracks available offline. Download music while you still have a
					connection.
				</p>
				<Button asChild className="mt-4">
					<Link to="/downloads">Open downloads</Link>
				</Button>
			</div>
		)
	}

	return (
		<ul className="divide-y rounded-lg border">
			{tracks.map((track, index) => (
				<TrackListItem
					key={track.trackId}
					track={{
						id: track.trackId,
						title: track.title,
						artist: { id: track.artistId, name: track.artistName },
						duration: track.duration,
						coverImage: track.coverObjectKey
							? { objectKey: track.coverObjectKey }
							: null,
						serviceUrl: null,
						audioFiles: [{ id: track.trackId, format: 'mp3', objectKey: '' }],
					}}
					userTrack={{ createdAt: new Date(track.lastAccessedAt) }}
					index={index}
					playlistContext={{ type: 'library' }}
					itemActions={({ trackId: _trackId }) => (
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
					)}
				/>
			))}
		</ul>
	)
}
