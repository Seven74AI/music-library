import { useState } from 'react'
import { useAudioPlayer } from '#app/components/audio-player-provider.tsx'
import { TrackThumbnail } from '#app/components/track-thumbnail.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { type HomeRecentTrack } from '#app/utils/home.server.ts'
import { cn } from '#app/utils/misc.tsx'

type HomeRecentTrackCardProps = {
	userTrack: HomeRecentTrack
	index: number
}

export function HomeRecentTrackCard({
	userTrack,
	index,
}: HomeRecentTrackCardProps) {
	const [isHovered, setIsHovered] = useState(false)
	const { currentTrack, currentIndex, playTrack } = useAudioPlayer()
	const track = userTrack.track
	const hasAudio = track.audioFiles.length > 0
	const isPlaying = currentTrack?.id === track.id && currentIndex === index

	const handlePlay = () => {
		if (!hasAudio) return
		playTrack(track, { type: 'library' }, index)
	}

	return (
		<button
			type="button"
			className={cn(
				'group w-36 shrink-0 text-left sm:w-40',
				!hasAudio && 'cursor-not-allowed',
			)}
			onClick={handlePlay}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			disabled={!hasAudio}
			aria-label={`${track.title} by ${track.artist.name}${
				hasAudio ? '' : ' (archiving)'
			}`}
		>
			<div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
				<TrackThumbnail
					coverImage={track.coverImage}
					alt={track.title}
					size="lg"
					pixelSize={320}
					className="h-full w-full rounded-lg"
				/>

				{hasAudio ? (
					<div
						className={cn(
							'absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity',
							isHovered || isPlaying ? 'opacity-100' : 'opacity-0',
						)}
					>
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
							<Icon
								name={isPlaying ? 'pause' : 'play'}
								className="h-5 w-5"
							/>
						</div>
					</div>
				) : (
					<div className="absolute inset-0 flex items-end justify-start bg-black/30 p-2">
						<span className="rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
							Archiving
						</span>
					</div>
				)}
			</div>

			<div className="mt-2 space-y-0.5">
				<p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
					{track.title}
				</p>
				<p className="truncate text-xs text-muted-foreground">
					{track.artist.name}
				</p>
			</div>
		</button>
	)
}
