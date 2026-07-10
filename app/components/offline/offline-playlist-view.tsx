import { Link } from 'react-router'
import { TrackListItem } from '#app/components/track-list-item.tsx'
import { OfflineTrackDownloadButton } from '#app/components/offline/offline-track-download-button.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { type OfflineTrackSummary } from '#app/features/offline-storage/types.ts'

type OfflinePlaylistViewProps = {
	playlistId: string
	title: string
	description: string | null
	tracks: OfflineTrackSummary[]
}

export function OfflinePlaylistView({
	playlistId,
	title,
	description,
	tracks,
}: OfflinePlaylistViewProps) {
	return (
		<div className="space-y-6">
			<div>
				<p className="text-muted-foreground mb-2 text-sm">Offline playlist</p>
				<h1 className="text-3xl font-bold">{title}</h1>
				{description ? (
					<p className="text-muted-foreground mt-2">{description}</p>
				) : null}
				<p className="text-muted-foreground mt-2 text-sm">
					{tracks.length} downloaded track{tracks.length === 1 ? '' : 's'}
				</p>
			</div>

			{tracks.length === 0 ? (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<p className="text-muted-foreground">
						No tracks from this playlist are downloaded yet. Download the playlist while
						you still have a connection.
					</p>
					<Button asChild className="mt-4">
						<Link to={`/playlists/${playlistId}`}>Back to playlist</Link>
					</Button>
				</div>
			) : (
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
							playlistContext={{ type: 'playlist', playlistId }}
							showPlaylistActions={false}
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
			)}
		</div>
	)
}
