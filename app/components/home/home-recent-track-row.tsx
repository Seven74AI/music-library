import { TrackListItem } from '#app/components/track-list-item.tsx'
import { type HomeRecentTrack } from '#app/utils/home.server.ts'

type HomeRecentTrackRowProps = {
	recentTracks: HomeRecentTrack[]
}

export function HomeRecentTrackRow({ recentTracks }: HomeRecentTrackRowProps) {
	if (recentTracks.length === 0) {
		return (
			<p className="text-muted-foreground py-4 text-center text-sm">
				No tracks yet
			</p>
		)
	}

	return (
		<div className="flex gap-3 overflow-x-auto pb-2">
			{recentTracks.map((userTrack, index) => (
				<div
					key={userTrack.id}
					className="w-72 shrink-0 rounded-lg border bg-card"
				>
					<TrackListItem
						track={userTrack.track}
						userTrack={userTrack}
						index={index}
						playlistContext={{ type: 'library' }}
						showDuration
					/>
				</div>
			))}
		</div>
	)
}
