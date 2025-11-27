import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from '#app/components/audio-player-provider'
import { TrackThumbnail } from '#app/components/track-thumbnail'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { ScrollArea } from '#app/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet'
import { type FullTrack, type QueueTrack } from '#app/types/frontend/shared'

type Track = FullTrack

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

export function AudioPlayer(props: AudioPlayerProps) {
	const { track, isVisible, onClose, onNext, onPrevious, onToggleLoop, onToggleShuffle, hasNext, hasPrevious, loopMode, isShuffleEnabled } = props
	const audioRef = useRef<HTMLAudioElement>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [volume] = useState(1)
	const previousTrackIdRef = useRef<string | null>(null)
	const isManualPlayRef = useRef(false)
	
	const getBestAudioFile = () => {
		if (!track?.audioFiles || track.audioFiles.length === 0) {
			return null
		}
		
		// Priority: FLAC > WAV > MP3 > M4A > OGG > AAC > WebM > others
		// Matches server-side priority in audio-file-selection.server.ts
		const priority = ['flac', 'wav', 'mp3', 'm4a', 'ogg', 'aac', 'webm']
		for (const format of priority) {
			const file = track.audioFiles.find(f => f.format === format)
			if (file) return file
		}
		return track.audioFiles[0]
	}
	
	const audioFile = getBestAudioFile()
	const audioUrl = audioFile && track ? `/resources/audio/${track.id}` : null
	
	useEffect(() => {
		if (audioRef.current) {
			setIsPlaying(!audioRef.current.paused)
		}
	}, [])

	useEffect(() => {
		if (audioRef.current && track && audioUrl && track.id !== previousTrackIdRef.current) {
			previousTrackIdRef.current = track.id
			setIsPlaying(false)
			audioRef.current.volume = volume
			// Only auto-play if not manually triggered (prevents double-click issue)
			if (!isManualPlayRef.current) {
				const playPromise = audioRef.current.play()
				if (playPromise !== undefined) {
					playPromise
						.then(() => {
							setIsPlaying(true)
						})
						.catch(() => {
							setIsPlaying(false)
						})
				}
			}
			isManualPlayRef.current = false
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [track?.id, audioUrl, volume, loopMode])
	
	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.loop = loopMode === 'one'
		}
	}, [loopMode])
	
	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return
		
		const updateTime = () => {
			// Don't update time while seeking to avoid conflicts
			if (!audio.seeking) {
				setCurrentTime(audio.currentTime)
			}
		}
		const handlePlay = () => setIsPlaying(true)
		const handlePause = () => setIsPlaying(false)
		const handleSeeking = () => {
			// Browser manages seeking state automatically via audio.seeking property
			// This listener is kept for potential future use (e.g., showing loading indicator)
		}
		const handleSeeked = () => {
			const audio = audioRef.current
			if (!audio) return
			// Sync time after seeking completes - this is the authoritative event
			setCurrentTime(audio.currentTime)
		}
		const handleLoadedMetadata = () => {
			if (audioRef.current) {
				const newDuration = audioRef.current.duration
				if (!isNaN(newDuration) && isFinite(newDuration) && newDuration > 0) {
					setDuration(newDuration)
				}
			}
		}
		const handleEnded = () => {
			setIsPlaying(false)
			// Only auto-advance if not looping one track
			if (loopMode !== 'one') {
				onNext()
			}
		}
		
		audio.addEventListener('timeupdate', updateTime)
		audio.addEventListener('loadedmetadata', handleLoadedMetadata)
		audio.addEventListener('play', handlePlay)
		audio.addEventListener('pause', handlePause)
		audio.addEventListener('seeking', handleSeeking)
		audio.addEventListener('seeked', handleSeeked)
		audio.addEventListener('ended', handleEnded)
		
		return () => {
			audio.removeEventListener('timeupdate', updateTime)
			audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
			audio.removeEventListener('play', handlePlay)
			audio.removeEventListener('pause', handlePause)
			audio.removeEventListener('seeking', handleSeeking)
			audio.removeEventListener('seeked', handleSeeked)
			audio.removeEventListener('ended', handleEnded)
		}
	}, [onNext, loopMode, track])
	
	const togglePlayPause = async () => {
		if (!audioRef.current) return
		
		const wasPlaying = isPlaying
		isManualPlayRef.current = true
		
		try {
			if (wasPlaying) {
				audioRef.current.pause()
			} else {
				await audioRef.current.play()
			}
		} catch (error) {
			setIsPlaying(wasPlaying)
			console.error('Playback error:', error)
		}
	}
	
	const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!audioRef.current) return
		
		const newTime = parseFloat(e.target.value)
		const audio = audioRef.current
		
		if (isNaN(newTime) || newTime < 0) return
		
		// readyState >= 1 (HAVE_METADATA) means seeking won't raise an exception
		// Browser will handle loading the range if needed
		const readyStateCheck = audio.readyState >= 1
		const durationCheck = duration > 0 && !isNaN(duration) && isFinite(duration)
		const canSeek = readyStateCheck || durationCheck
		
		if (!canSeek) return
		
		const clampedTime = duration > 0 ? Math.min(Math.max(0, newTime), duration) : newTime
		
		try {
			// Optimistic update for smooth UI - seeked event will correct if needed
			audio.currentTime = clampedTime
			setCurrentTime(clampedTime)
		} catch (error) {
			console.error('Seek failed:', error)
		}
	}
	
	const handleSeekStart = () => {
		// Browser manages seeking state automatically
		// This handler is kept for potential future use (e.g., disabling other controls during seek)
	}
	
	const handleSeekEnd = () => {
		// Browser manages seeking state via audio.seeking property
		// The seeked event will fire when seeking completes
	}
	
	const formatTime = (seconds: number) => {
		if (isNaN(seconds)) return '0:00'
		const mins = Math.floor(seconds / 60)
		const secs = Math.floor(seconds % 60)
		return `${mins}:${secs.toString().padStart(2, '0')}`
	}
	
	if (!isVisible || !track || !audioUrl) {
		return null
	}
	
	return (
		<div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg z-50">
			<div className="container mx-auto px-4 py-3">
				<div className="flex items-center gap-4">
					<div className="flex items-center gap-3 min-w-0 w-64">
						<TrackThumbnail 
							thumbnailUrl={track.thumbnailUrl}
							alt={track.title}
							size="lg"
							className="shadow-md"
						/>
						<div className="flex-1 min-w-0">
							<p className="font-semibold text-sm truncate">{track.title}</p>
							<p className="text-xs text-muted-foreground truncate">{track.artist}</p>
						</div>
					</div>
					
					<div className="flex flex-col items-center gap-2 flex-1 max-w-2xl">
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={onPrevious}
								disabled={!hasPrevious}
								aria-label="Previous track"
								className="h-8 w-8 p-0"
							>
								<Icon name="arrow-left" className="h-4 w-4" />
							</Button>
							<Button
								variant="default"
								size="lg"
								onClick={togglePlayPause}
								aria-label={isPlaying ? 'Pause' : 'Play'}
								className="h-10 w-10 rounded-full p-0"
							>
								<Icon 
									name={isPlaying ? 'pause' : 'play'} 
									className={`h-5 w-5 ${isPlaying ? '' : 'ml-0.5'}`}
								/>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={onNext}
								disabled={!hasNext}
								aria-label="Next track"
								className="h-8 w-8 p-0"
							>
								<Icon name="arrow-right" className="h-4 w-4" />
							</Button>
						</div>
						
						<div className="flex items-center gap-2 w-full">
							<span className="text-xs text-muted-foreground tabular-nums min-w-[3rem] text-right">
								{formatTime(currentTime)}
							</span>
						<input
							type="range"
							min="0"
							max={duration || 0}
							step="0.1"
							value={isNaN(currentTime) ? 0 : currentTime}
							onChange={handleSeek}
							onMouseDown={handleSeekStart}
							onMouseUp={handleSeekEnd}
							onTouchStart={handleSeekStart}
							onTouchEnd={handleSeekEnd}
							className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
							style={{
								background: duration > 0 ? `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${(currentTime / duration) * 100}%, hsl(var(--muted)) ${(currentTime / duration) * 100}%, hsl(var(--muted)) 100%)` : undefined
							}}
							aria-label="Seek"
						/>
							<span className="text-xs text-muted-foreground tabular-nums min-w-[3rem]">
								{formatTime(duration)}
							</span>
						</div>
					</div>
					
					<div className="flex items-center gap-1 w-64 justify-end">
						<QueueSheet />
						<Button
							variant="ghost"
							size="sm"
							onClick={onToggleLoop}
							aria-label={`Loop: ${loopMode === 'off' ? 'off' : loopMode === 'all' ? 'all' : 'one'}`}
							className={`h-8 w-8 p-0 relative ${
								loopMode === 'off' 
									? 'text-muted-foreground hover:text-foreground hover:bg-muted' 
									: 'text-primary bg-primary/10 hover:bg-primary/20'
							}`}
							title={`Loop: ${loopMode === 'off' ? 'Off' : loopMode === 'all' ? 'All tracks' : 'One track'}`}
						>
							<Icon 
								name="arrow-path" 
								className="h-4 w-4"
							/>
							{loopMode === 'one' && (
								<span 
									className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center leading-none"
									aria-label="Looping one track"
								>
									1
								</span>
							)}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={onToggleShuffle}
							aria-label={`Shuffle: ${isShuffleEnabled ? 'on' : 'off'}`}
							className={`h-8 w-8 p-0 ${
								isShuffleEnabled 
									? 'text-primary bg-primary/10 hover:bg-primary/20' 
									: 'text-muted-foreground hover:text-foreground hover:bg-muted'
							}`}
							title={`Shuffle: ${isShuffleEnabled ? 'On' : 'Off'}`}
						>
							<Icon 
								name="shuffle" 
								className="h-4 w-4" 
							/>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={onClose}
							aria-label="Close player"
							className="h-8 w-8 p-0"
						>
							<Icon name="x-mark" className="h-4 w-4" />
						</Button>
					</div>
				</div>
				
				<audio
					ref={audioRef}
					src={audioUrl}
					loop={loopMode === 'one'}
					preload="metadata"
				/>
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
 * - Uses virtual scrolling for large queues (5k+ tracks)
 */
function QueueSheet() {
	const { playlist, currentTrack, currentIndex, removeTrackFromPlaylist } = useAudioPlayer()
	const parentRef = useRef<HTMLDivElement>(null)
	const [isOpen, setIsOpen] = useState(false)

	const virtualizer = useVirtualizer({
		count: playlist.length,
		getScrollElement: () => parentRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement || null,
		estimateSize: () => 60,
		overscan: 10,
		rangeExtractor: defaultRangeExtractor,
	})

	useEffect(() => {
		if (!isOpen || currentIndex < 0 || currentIndex >= playlist.length) {
			return undefined
		}

		const scrollToCurrentTrack = (attempt = 0) => {
			const scrollElement = parentRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
			if (!scrollElement) {
				if (attempt < 5) {
					setTimeout(() => scrollToCurrentTrack(attempt + 1), 50)
				}
				return
			}

			virtualizer.measure()

			requestAnimationFrame(() => {
				setTimeout(() => {
					try {
						virtualizer.scrollToIndex(currentIndex, {
							align: 'center',
							behavior: 'smooth',
						})
					} catch (error) {
						console.warn('Failed to scroll to index, retrying...', error)
						setTimeout(() => {
							virtualizer.scrollToIndex(currentIndex, {
								align: 'center',
								behavior: 'smooth',
							})
						}, 100)
					}
				}, 100)
			})
		}

		const timeoutId = setTimeout(() => scrollToCurrentTrack(0), 200)
		return () => clearTimeout(timeoutId)
	}, [isOpen, currentIndex, playlist.length, virtualizer])

	return (
		<Sheet open={isOpen} onOpenChange={setIsOpen}>
			<SheetTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 w-8 p-0"
					title="Queue"
					aria-label="Open queue"
				>
					<Icon name="list-bullet" className="h-4 w-4" />
				</Button>
			</SheetTrigger>
			<SheetContent side="bottom" className="h-[80vh] flex flex-col">
				<SheetHeader className="flex-shrink-0">
					<SheetTitle>Queue ({playlist.length} tracks)</SheetTitle>
				</SheetHeader>
				<div className="flex-1 mt-6 min-h-0">
					{playlist.length === 0 ? (
						<div className="text-center py-12">
							<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
							<h3 className="text-lg font-semibold mb-2">Queue is Empty</h3>
							<p className="text-muted-foreground">
								Add tracks to your queue to see them here.
							</p>
						</div>
					) : (
						<ScrollArea className="h-full w-full" ref={parentRef}>
							<div
								style={{
									height: `${virtualizer.getTotalSize()}px`,
									width: '100%',
									position: 'relative',
								}}
							>
								{virtualizer.getVirtualItems().map((virtualItem) => {
									const track = playlist[virtualItem.index]
									if (!track) return null

									return (
										<div
											key={`${track.id}-${virtualItem.index}`}
											style={{
												position: 'absolute',
												top: 0,
												left: 0,
												width: '100%',
												height: `${virtualItem.size}px`,
												transform: `translateY(${virtualItem.start}px)`,
											}}
										>
											<QueueTrackItem
												track={track}
												isCurrentlyPlaying={currentTrack?.id === track.id && currentIndex === virtualItem.index}
												onRemove={() => removeTrackFromPlaylist(virtualItem.index)}
											/>
										</div>
									)
								})}
							</div>
						</ScrollArea>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}

function QueueTrackItem({ track, isCurrentlyPlaying, onRemove }: { track: Track | QueueTrack, isCurrentlyPlaying: boolean, onRemove: () => void }) {
	const thumbnailUrl = 'thumbnailUrl' in track ? track.thumbnailUrl : null

	return (
		<div className={`group flex items-center gap-3 px-4 py-3 rounded-md hover:bg-muted/50 transition-colors ${
			isCurrentlyPlaying ? 'bg-primary/10 border-l-4 border-primary' : ''
		}`}>
			<div className="flex-shrink-0 relative">
				<TrackThumbnail 
					thumbnailUrl={thumbnailUrl}
					alt={track.title}
					size="md"
				/>
				{isCurrentlyPlaying && (
					<div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
						<Icon name="play" className="h-2 w-2 text-primary-foreground" />
					</div>
				)}
			</div>

			<div className="flex-1 min-w-0">
				<div className="font-medium text-sm truncate">
					{track.title}
				</div>
				<div className="text-xs text-muted-foreground truncate">
					{track.artist}
				</div>
			</div>

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
