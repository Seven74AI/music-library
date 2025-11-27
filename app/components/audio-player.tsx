import { useAudioPlayer } from '#app/components/audio-player-provider'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet'

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
}

interface AudioPlayerProps {
	track: Track | null
	isVisible: boolean
	onClose: () => void
	onNext: () => void
	onPrevious: () => void
	onToggleLoop: () => void
	onToggleShuffle: () => void
	hasNext: boolean
	hasPrevious: boolean
	loopMode: 'off' | 'all' | 'one'
	isShuffleEnabled: boolean
}

export function AudioPlayer(_props: AudioPlayerProps) {
	// Audio player disabled - no audio downloads available
	return null
}

/**
 * Queue Sheet Component - Displays the current playlist queue
 * 
 * Features:
 * - Shows all tracks in the current playlist
 * - Highlights the currently playing track (by ID and position)
 * - Allows removal of specific tracks by position
 * - Supports duplicate tracks with unique keys
 * 
 * Note: Currently unused as AudioPlayer is disabled, but kept for future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function QueueSheet() {
	const { playlist, currentTrack, currentIndex, removeTrackFromPlaylist } = useAudioPlayer()

	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 w-8 p-0"
					title="Queue"
				>
					<Icon name="file-text" className="h-4 w-4" />
				</Button>
			</SheetTrigger>
			<SheetContent side="bottom" className="h-[80vh] flex flex-col">
				<SheetHeader className="flex-shrink-0">
					<SheetTitle>Queue ({playlist.length} tracks)</SheetTitle>
				</SheetHeader>
				<div className="flex-1 overflow-y-auto mt-6">
					{playlist.length === 0 ? (
						<div className="text-center py-12">
							<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
							<h3 className="text-lg font-semibold mb-2">Queue is Empty</h3>
							<p className="text-muted-foreground">
								Add tracks to your queue to see them here.
							</p>
						</div>
					) : (
						<div className="space-y-1 pb-4">
							{playlist.map((track, index) => (
								<QueueTrackItem
									key={`${track.id}-${index}`}  // Combine ID and index for unique key
									track={track}
									isCurrentlyPlaying={currentTrack?.id === track.id && currentIndex === index}
									onRemove={() => removeTrackFromPlaylist(index)}
								/>
							))}
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}

/**
 * Queue Track Item Component - Individual track item in the queue
 * 
 * @param track - The track data
 * @param isCurrentlyPlaying - Whether this specific track instance is currently playing
 * @param onRemove - Callback to remove this track from the queue
 */
function QueueTrackItem({ track, isCurrentlyPlaying, onRemove }: { track: Track, isCurrentlyPlaying: boolean, onRemove: () => void }) {
	const thumbnailUrl = track.thumbnailUrl 
		? `/resources/images?src=${encodeURIComponent(track.thumbnailUrl)}&w=48&h=48&fit=cover&format=webp`
		: null

	return (
		<div className={`group flex items-center gap-3 px-4 py-3 rounded-md hover:bg-muted/50 transition-colors ${
			isCurrentlyPlaying ? 'bg-primary/10 border-l-4 border-primary' : ''
		}`}>
			{/* Cover */}
			<div className="flex-shrink-0 relative">
				{thumbnailUrl ? (
					<img 
						src={thumbnailUrl} 
						alt={track.title}
						className="h-12 w-12 rounded object-cover"
						loading="lazy"
					/>
				) : (
					<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
						<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
					</div>
				)}
				{isCurrentlyPlaying && (
					<div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
						<Icon name="play" className="h-2 w-2 text-primary-foreground" />
					</div>
				)}
			</div>

			{/* Title and Artist */}
			<div className="flex-1 min-w-0">
				<div className="font-medium text-sm truncate">
					{track.title}
				</div>
				<div className="text-xs text-muted-foreground truncate">
					{track.artist}
				</div>
			</div>

			{/* Remove Button */}
			<div className="flex-shrink-0">
				<Button
					variant="ghost"
					size="sm"
					className="h-8 w-8 p-0"
					onClick={onRemove}
					aria-label={`Remove ${track.title} from queue`}
				>
					<Icon name="trash" className="h-4 w-4" />
				</Button>
			</div>
		</div>
	)
}
