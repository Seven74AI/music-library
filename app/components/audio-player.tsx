import { useState, useRef, useEffect, useCallback } from 'react'
import { useAudioPlayer } from '#app/components/audio-player-provider'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet'
import { Slider } from '#app/components/ui/slider'
import { formatDuration } from '#app/utils/format-duration'
import { getAudioSrc } from '#app/utils/misc'

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
	audioFile?: {
		objectKey: string | null
		fileSize: number | null
		status: string
	} | null
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

export function AudioPlayer({ 
	track, 
	isVisible, 
	onClose, 
	onNext, 
	onPrevious, 
	onToggleLoop, 
	onToggleShuffle,
	hasNext, 
	hasPrevious, 
	loopMode,
	isShuffleEnabled
}: AudioPlayerProps) {
	const audioRef = useRef<HTMLAudioElement>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [volume, setVolume] = useState(50)
	const [isMuted, setIsMuted] = useState(false)
	const [isLoading, setIsLoading] = useState(false)

	// Update duration when track changes and auto-play
	useEffect(() => {
		if (track?.duration) {
			setDuration(track.duration)
		}
		
		// Reset playing state when track changes
		setIsPlaying(false)
		
		// Auto-play when a new track is set
		if (track && audioRef.current && track.audioFile?.objectKey) {
			const audio = audioRef.current
			audio.load() // Reload the audio element with new source
			
			// Use a small delay to ensure the audio is ready
			setTimeout(() => {
				if (audio && !audio.paused) return // Already playing
				void audio.play().catch(error => {
					console.error('Failed to auto-play audio:', error)
				})
			}, 100)
		}
	}, [track])

	// Handle audio events
	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return

		const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
		const handleDurationChange = () => {
			// Only use audio duration if we don't have track duration
			if (!track?.duration && audio.duration) {
				setDuration(Math.floor(audio.duration)) // Round to avoid decimals
			}
		}
		const handlePlay = () => setIsPlaying(true)
		const handlePause = () => setIsPlaying(false)
		const handleLoadStart = () => setIsLoading(true)
		const handleCanPlay = () => setIsLoading(false)
		const handleEnded = () => {
			setIsPlaying(false)
			setCurrentTime(0)
			
			// Handle loop modes
			if (loopMode === 'one') {
				// Loop one: restart current track
				if (audio) {
					audio.currentTime = 0
					void audio.play().catch(error => {
						console.error('Failed to restart track:', error)
					})
				}
			} else if (hasNext) {
				// Only go to next if there is a next track available
				onNext()
			}
			// If no next track and not looping, playback stops
		}

		audio.addEventListener('timeupdate', handleTimeUpdate)
		audio.addEventListener('durationchange', handleDurationChange)
		audio.addEventListener('play', handlePlay)
		audio.addEventListener('pause', handlePause)
		audio.addEventListener('loadstart', handleLoadStart)
		audio.addEventListener('canplay', handleCanPlay)
		audio.addEventListener('ended', handleEnded)

		return () => {
			audio.removeEventListener('timeupdate', handleTimeUpdate)
			audio.removeEventListener('durationchange', handleDurationChange)
			audio.removeEventListener('play', handlePlay)
			audio.removeEventListener('pause', handlePause)
			audio.removeEventListener('loadstart', handleLoadStart)
			audio.removeEventListener('canplay', handleCanPlay)
			audio.removeEventListener('ended', handleEnded)
		}
	}, [onNext, loopMode, hasNext, track?.duration])

	// Update volume
	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.volume = isMuted ? 0 : volume / 100
		}
	}, [volume, isMuted])

	const handlePlayPause = useCallback(() => {
		if (!audioRef.current || !track) return

		if (isPlaying) {
			audioRef.current.pause()
		} else {
			void audioRef.current.play().catch(error => {
				console.error('Failed to play audio:', error)
			})
		}
	}, [isPlaying, track])

	const handleSeek = useCallback((value: number[]) => {
		const audio = audioRef.current
		if (audio && duration > 0 && value[0] !== undefined) {
			const newTime = (value[0] / 100) * duration
			audio.currentTime = newTime
			setCurrentTime(newTime)
		}
	}, [duration])

	const handleVolumeChange = useCallback((value: number[]) => {
		if (value[0] !== undefined) {
			setVolume(value[0])
			setIsMuted(value[0] === 0)
		}
	}, [])

	const handleMute = useCallback(() => {
		setIsMuted(prev => !prev)
	}, [])

	if (!isVisible || !track) return null

	// Only render if track has completed audio file
	const hasPlayableAudio = track.audioFile?.objectKey && track.audioFile.status === 'completed'
	if (!hasPlayableAudio) return null

	const audioSrc = track.audioFile?.objectKey ? getAudioSrc(track.audioFile.objectKey) : undefined

	return (
		<div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-50">
			{/* Hidden audio element */}
			<audio
				ref={audioRef}
				src={audioSrc || undefined}
				preload="metadata"
			/>

			{/* Progress bar with seek functionality */}
			<div className="w-full px-4 py-2">
				<Slider
					value={[duration > 0 ? (currentTime / duration) * 100 : 0]}
					onValueChange={handleSeek}
					max={100}
					step={0.1}
					className="w-full"
				/>
			</div>

			{/* Player controls */}
			<div className="flex items-center justify-between px-4 py-3">
				{/* Track info */}
				<div className="flex items-center gap-3 min-w-0 flex-1">
					{track.thumbnailUrl ? (
						<img 
							src={`/resources/images?src=${encodeURIComponent(track.thumbnailUrl)}&w=48&h=48&fit=cover&format=webp`} 
							alt={track.title}
							className="h-12 w-12 rounded object-cover"
						/>
					) : (
						<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
							<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
						</div>
					)}
					<div className="min-w-0 flex-1">
						<div className="font-medium text-sm truncate">{track.title}</div>
						<div className="text-xs text-muted-foreground truncate">{track.artist}</div>
					</div>
				</div>

				{/* Main controls */}
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={onPrevious}
						disabled={!hasPrevious}
						className="h-8 w-8 p-0"
					>
						<Icon name="backward" className="h-4 w-4" />
					</Button>
					
					<Button
						variant="ghost"
						size="sm"
						onClick={handlePlayPause}
						disabled={isLoading}
						className="h-10 w-10 p-0"
					>
						{isLoading ? (
							<div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
						) : isPlaying ? (
							<Icon name="pause" className="h-5 w-5" />
						) : (
							<Icon name="play" className="h-5 w-5" />
						)}
					</Button>
					
					<Button
						variant="ghost"
						size="sm"
						onClick={onNext}
						disabled={!hasNext}
						className="h-8 w-8 p-0"
					>
						<Icon name="forward" className="h-4 w-4" />
					</Button>
					
					<Button
						variant="ghost"
						size="sm"
						onClick={onToggleShuffle}
						className={`h-8 w-8 p-0 ${
							isShuffleEnabled 
								? 'text-primary hover:text-primary/80' 
								: 'text-muted-foreground hover:text-foreground'
						}`}
						title={isShuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
					>
						<Icon name="shuffle" className="h-4 w-4" />
					</Button>

					<Button
						variant="ghost"
						size="sm"
						onClick={onToggleLoop}
						className={`h-8 w-8 p-0 relative ${
							loopMode === 'off' 
								? 'text-muted-foreground hover:text-foreground' 
								: 'text-green-500 hover:text-green-600'
						}`}
						title={
							loopMode === 'off' ? 'Loop off' :
							loopMode === 'all' ? 'Loop all' :
							'Loop one'
						}
					>
						<Icon name="arrow-path-rounded-square" className="h-4 w-4" />
						{loopMode === 'one' && (
							<span className="absolute -top-1 -right-1 text-xs font-bold text-green-500 bg-background rounded-full w-4 h-4 flex items-center justify-center">1</span>
						)}
					</Button>

					{/* Queue button */}
					<QueueSheet />
				</div>

				{/* Volume and time */}
				<div className="flex items-center gap-3 min-w-0 flex-1 justify-end">
					{/* Time display */}
					<div className="text-xs text-muted-foreground whitespace-nowrap">
						{formatDuration(currentTime)} / {formatDuration(duration)}
					</div>

					{/* Volume control */}
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={handleMute}
							className="h-8 w-8 p-0"
						>
							<Icon 
								name={isMuted || volume === 0 ? "speaker-x-mark" : "speaker-wave"} 
								className="h-4 w-4" 
							/>
						</Button>
						<div className="w-20">
							<Slider
								value={[isMuted ? 0 : volume]}
								onValueChange={handleVolumeChange}
								max={100}
								step={1}
								className="w-full"
							/>
						</div>
					</div>

					{/* Close button */}
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						className="h-8 w-8 p-0"
					>
						<Icon name="x-mark" className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	)
}

/**
 * Queue Sheet Component - Displays the current playlist queue
 * 
 * Features:
 * - Shows all tracks in the current playlist
 * - Highlights the currently playing track (by ID and position)
 * - Allows removal of specific tracks by position
 * - Supports duplicate tracks with unique keys
 */
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
