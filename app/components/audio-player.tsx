import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAudioPlayer } from '#app/components/audio-player-provider'
import { AddToPlaylistMenu } from '#app/components/add-to-playlist-menu'
import { TrackDetailsDialog } from '#app/components/track-details-dialog'
import {
	formatQueueSheetTitle,
	getSpineSectionHeading,
	getSpineSectionLabel,
} from '#app/components/queue-sheet-ui'
import { TrackThumbnail } from '#app/components/track-thumbnail'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '#app/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet'
import { toast } from '#app/components/ui/use-toast.ts'
import { selectBestAudioFile } from '#app/domain/audio-format.ts'
import {
	clearBlobUrlCache,
	resolveTrackPlaybackSource,
	revokePlaybackAudioUrl,
} from '#app/features/offline-storage/resolve-playback-url.client.ts'
import { useOnlineStatus } from '#app/hooks/use-online-status.ts'
import { type FullTrack } from '#app/types/frontend/shared'
import { triggerBrowserDownload } from '#app/utils/download.ts'
import {
	buildMediaSessionMetadata,
	clearMediaSessionPositionState,
	clampMediaSessionSeekTime,
	isMediaSessionSupported,
	updateMediaSessionPositionState,
} from '#app/utils/media-session.client.ts'
import { cn } from '#app/utils/misc'
import {
	adjustVolumeStep,
	getPlayerKeyboardAction,
} from '#app/utils/player-keyboard-shortcuts.ts'
import {
	DEFAULT_PLAYER_VOLUME,
	readStoredVolume,
	writeStoredVolume,
} from '#app/utils/player-preferences.ts'
import {
	createSleepTimerEndAt,
	formatSleepTimerRemaining,
	isSleepTimerExpired,
	SLEEP_TIMER_PRESETS_MINUTES,
} from '#app/utils/sleep-timer.ts'

type Track = FullTrack

function formatPlayerTime(seconds: number) {
	if (isNaN(seconds) || !isFinite(seconds)) return '0:00'
	const mins = Math.floor(seconds / 60)
	const secs = Math.floor(seconds % 60)
	return `${mins}:${secs.toString().padStart(2, '0')}`
}

function isDurationKnown(duration: number): boolean {
	return duration > 0 && isFinite(duration) && !isNaN(duration)
}

function getPlaybackProgressPercent(currentTime: number, duration: number) {
	if (duration <= 0 || !isFinite(duration)) return 0
	return Math.min(100, Math.max(0, (currentTime / duration) * 100))
}

function getMediaErrorMessage(code: number): string {
	switch (code) {
		case 1: // MEDIA_ERR_ABORTED
			return 'Playback was interrupted.'
		case 2: // MEDIA_ERR_NETWORK
			return 'A network error prevented the audio from loading. Check your connection.'
		case 3: // MEDIA_ERR_DECODE
			return 'This audio format is not supported by your browser.'
		case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
			return 'The audio source could not be found or is not supported.'
		default:
			return 'An unexpected playback error occurred. Please try again.'
	}
}

interface PlayerSeekBarProps {
	currentTime: number
	duration: number
	onSeek: (event: React.ChangeEvent<HTMLInputElement>) => void
	onSeekStart: () => void
	onSeekEnd: () => void
	className?: string
}

function PlayerSeekBar({
	currentTime,
	duration,
	onSeek,
	onSeekStart,
	onSeekEnd,
	className,
}: PlayerSeekBarProps) {
	return (
		<div className={cn('flex items-center gap-2 w-full', className)}>
			<span className="text-xs text-muted-foreground tabular-nums min-w-[3rem] text-right">
				{formatPlayerTime(currentTime)}
			</span>
			<input
				type="range"
				min="0"
				max={isDurationKnown(duration) ? duration : Infinity}
				step="0.1"
				value={isNaN(currentTime) ? 0 : currentTime}
				onChange={onSeek}
				onMouseDown={onSeekStart}
				onMouseUp={onSeekEnd}
				onTouchStart={onSeekStart}
				onTouchEnd={onSeekEnd}
				className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
				style={{
					background:
						isDurationKnown(duration)
							? `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${getPlaybackProgressPercent(currentTime, duration)}%, hsl(var(--muted)) ${getPlaybackProgressPercent(currentTime, duration)}%, hsl(var(--muted)) 100%)`
							: undefined,
				}}
				aria-label="Seek"
			/>
			<span className="text-xs text-muted-foreground tabular-nums min-w-[3rem]">
				{isDurationKnown(duration) ? formatPlayerTime(duration) : '--:--'}
			</span>
		</div>
	)
}

interface PlayerTransportControlsProps {
	isPlaying: boolean
	isAudioLoading: boolean
	hasNext: boolean
	hasPrevious: boolean
	onPrevious: () => void
	onNext: () => void
	onTogglePlayPause: () => void
	size?: 'default' | 'large'
}

function PlayerTransportControls({
	isPlaying,
	isAudioLoading,
	hasNext,
	hasPrevious,
	onPrevious,
	onNext,
	onTogglePlayPause,
	size = 'default',
}: PlayerTransportControlsProps) {
	const playButtonClass =
		size === 'large' ? 'h-14 w-14 rounded-full p-0' : 'h-10 w-10 rounded-full p-0'
	const playIconClass = size === 'large' ? 'h-6 w-6' : 'h-5 w-5'
	const navButtonClass =
		size === 'large' ? 'h-11 w-11 p-0' : 'h-8 w-8 p-0'

	return (
		<div className="flex items-center gap-2">
			<Button
				variant="ghost"
				size="sm"
				onClick={onPrevious}
				disabled={!hasPrevious}
				aria-label="Previous track"
				className={navButtonClass}
			>
				<Icon name="arrow-left" className="h-4 w-4" />
			</Button>
			<Button
				variant="default"
				size="lg"
				onClick={onTogglePlayPause}
				disabled={isAudioLoading}
				aria-label={isPlaying ? 'Pause' : 'Play'}
				className={playButtonClass}
			>
				<Icon
					name={isPlaying ? 'pause' : 'play'}
					className={`${playIconClass} ${isPlaying ? '' : 'ml-0.5'}`}
				/>
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={onNext}
				disabled={!hasNext}
				aria-label="Next track"
				className={navButtonClass}
			>
				<Icon name="arrow-right" className="h-4 w-4" />
			</Button>
		</div>
	)
}

interface PlayerLoopShuffleDownloadProps {
	loopMode: 'off' | 'all' | 'one'
	isShuffleEnabled: boolean
	isDownloading?: boolean
	onToggleLoop: () => void
	onToggleShuffle: () => void
	onDownload?: () => void
	buttonClassName?: string
}

function PlayerLoopShuffleDownload({
	loopMode,
	isShuffleEnabled,
	isDownloading = false,
	onToggleLoop,
	onToggleShuffle,
	onDownload,
	buttonClassName = 'h-8 w-8 p-0',
}: PlayerLoopShuffleDownloadProps) {
	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				onClick={onToggleLoop}
				aria-label={`Loop: ${loopMode === 'off' ? 'off' : loopMode === 'all' ? 'all' : 'one'}`}
				className={cn(
					buttonClassName,
					'relative',
					loopMode === 'off'
						? 'text-muted-foreground hover:text-foreground hover:bg-muted'
						: 'text-primary bg-primary/10 hover:bg-primary/20',
				)}
				title={`Loop: ${loopMode === 'off' ? 'Off' : loopMode === 'all' ? 'All tracks' : 'One track'}`}
			>
				<Icon name="arrow-path" className="h-4 w-4" />
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
				className={cn(
					buttonClassName,
					isShuffleEnabled
						? 'text-primary bg-primary/10 hover:bg-primary/20'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted',
				)}
				title={`Shuffle: ${isShuffleEnabled ? 'On' : 'Off'}`}
			>
				<Icon name="shuffle" className="h-4 w-4" />
			</Button>
			{onDownload && (
				<Button
					variant="ghost"
					size="sm"
					onClick={onDownload}
					disabled={isDownloading}
					aria-label="Download track"
					className={cn(
						buttonClassName,
						'text-muted-foreground hover:text-foreground hover:bg-muted',
					)}
					title="Download"
				>
				<Icon
					name={isDownloading ? 'arrow-path' : 'download'}
					className={`h-4 w-4 ${isDownloading ? 'animate-spin' : ''}`}
				/>
			</Button>
			)}
		</>
	)
}

interface PlayerChromeProps {
	track: Track
	isPlaying: boolean
	isAudioLoading: boolean
	currentTime: number
	duration: number
	loopMode: 'off' | 'all' | 'one'
	isShuffleEnabled: boolean
	isDownloading: boolean
	sleepTimerLabel: string | null
	hasNext: boolean
	hasPrevious: boolean
	isMuted: boolean
	volume: number
	onPrevious: () => void
	onNext: () => void
	onTogglePlayPause: () => void
	onToggleLoop: () => void
	onToggleShuffle: () => void
	onClose: () => void
	onDownload: () => void
	onSeek: (event: React.ChangeEvent<HTMLInputElement>) => void
	onSeekStart: () => void
	onSeekEnd: () => void
	onVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
	onToggleMute: () => void
	onStartSleepTimer: (minutes: number) => void
	onClearSleepTimer: () => void
}

interface PlayerMiniBarProps extends PlayerChromeProps {
	onOpenNowPlaying: () => void
}

function PlayerMiniBar({
	track,
	isPlaying,
	isAudioLoading,
	currentTime,
	duration,
	onTogglePlayPause,
	onClose,
	onOpenNowPlaying,
}: PlayerMiniBarProps) {
	const progress = getPlaybackProgressPercent(currentTime, duration)

	return (
		<div className="md:hidden" data-testid="player-mini-bar">
			<div
				className="h-0.5 w-full bg-muted"
				role="progressbar"
				aria-valuenow={Math.round(progress)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label="Playback progress"
			>
				<div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
			</div>
			<div className="flex items-center gap-2 px-3 py-2">
				<button
					type="button"
					onClick={onOpenNowPlaying}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
					aria-label="Open now playing"
				>
					<TrackThumbnail
						coverImage={track.coverImage}
						alt={track.title}
						size="md"
						className="shadow-md shrink-0"
					/>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold">{track.title}</p>
						<p className="truncate text-xs text-muted-foreground">{track.artist.name}</p>
					</div>
				</button>
				<Button
					variant="default"
					size="lg"
					onClick={onTogglePlayPause}
					disabled={isAudioLoading}
					aria-label={isPlaying ? 'Pause' : 'Play'}
					className="h-11 w-11 shrink-0 rounded-full p-0"
				>
					<Icon
						name={isPlaying ? 'pause' : 'play'}
						className={`h-5 w-5 ${isPlaying ? '' : 'ml-0.5'}`}
					/>
				</Button>
				<QueueSheet triggerClassName="h-11 w-11 shrink-0 p-0" />
				<Button
					variant="ghost"
					size="sm"
					onClick={onClose}
					aria-label="Close player"
					className="h-11 w-11 shrink-0 p-0"
				>
					<Icon name="x-mark" className="h-4 w-4" />
				</Button>
			</div>
		</div>
	)
}

interface PlayerNowPlayingSheetProps extends PlayerChromeProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

function PlayerNowPlayingSheet({
	open,
	onOpenChange,
	track,
	isPlaying,
	isAudioLoading,
	currentTime,
	duration,
	loopMode,
	isShuffleEnabled,
	isDownloading,
	sleepTimerLabel,
	hasNext,
	hasPrevious,
	onPrevious,
	onNext,
	onTogglePlayPause,
	onToggleLoop,
	onToggleShuffle,
	onDownload,
	onSeek,
	onSeekStart,
	onSeekEnd,
	onStartSleepTimer,
	onClearSleepTimer,
}: PlayerNowPlayingSheetProps) {
	const { playNextTrack, addToUpNext, addToQueue } = useAudioPlayer()
	const [isOverflowOpen, setIsOverflowOpen] = useState(false)
	const [isDetailsOpen, setIsDetailsOpen] = useState(false)
	const [isPlaylistSheetOpen, setIsPlaylistSheetOpen] = useState(false)

	const hasAudioFiles = track.audioFiles != null && track.audioFiles.length > 0

	const doQueueAction = (action: () => void, description: string) => {
		if (!hasAudioFiles) return
		action()
		toast({
			title: 'Success',
			description,
			variant: 'success',
		})
		setIsOverflowOpen(false)
	}

	const handlePlayNext = () => {
		doQueueAction(() => playNextTrack(track), `"${track.title}" will play next`)
	}

	const handleAddToUpNext = () => {
		doQueueAction(() => addToUpNext(track), `"${track.title}" added to up next`)
	}

	const handleAddToQueue = () => {
		doQueueAction(() => addToQueue(track), `"${track.title}" added to queue`)
	}

	return (
		<>
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="bottom"
				className="flex max-h-[85vh] flex-col gap-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
				data-testid="player-now-playing-sheet"
			>
				<SheetHeader className="flex-shrink-0 text-left">
					<SheetTitle>Now playing</SheetTitle>
					<SheetDescription className="sr-only">
						Expanded playback controls for the current track
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col items-center gap-4">
					<TrackThumbnail
						coverImage={track.coverImage}
						alt={track.title}
						size="lg"
						pixelSize={320}
						className="shadow-lg h-40 w-40"
					/>
					<div className="w-full text-center">
						<p className="truncate text-lg font-semibold">{track.title}</p>
						<p className="truncate text-sm text-muted-foreground">{track.artist.name}</p>
					</div>
				</div>
				<PlayerSeekBar
					currentTime={currentTime}
					duration={duration}
					onSeek={onSeek}
					onSeekStart={onSeekStart}
					onSeekEnd={onSeekEnd}
				/>
			<div className="flex items-center justify-center gap-2">
				<div className="flex-1" />
				<PlayerTransportControls
					isPlaying={isPlaying}
					isAudioLoading={isAudioLoading}
					hasNext={hasNext}
					hasPrevious={hasPrevious}
					onPrevious={onPrevious}
					onNext={onNext}
					onTogglePlayPause={onTogglePlayPause}
					size="large"
				/>
				<div className="flex-1 flex justify-end">
					<QueueSheet triggerClassName="h-11 w-11 shrink-0 p-0" />
				</div>
			</div>
			<div className="flex items-center justify-center gap-1">
				<PlayerLoopShuffleDownload
					loopMode={loopMode}
					isShuffleEnabled={isShuffleEnabled}
					onToggleLoop={onToggleLoop}
					onToggleShuffle={onToggleShuffle}
					buttonClassName="h-11 w-11 p-0"
				/>
				<Sheet open={isPlaylistSheetOpen} onOpenChange={setIsPlaylistSheetOpen}>
					<SheetTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
							aria-label="Add to playlist"
							title="Add to playlist"
						>
							<Icon name="plus" className="h-4 w-4" />
						</Button>
					</SheetTrigger>
					<SheetContent
						side="bottom"
						className="flex max-h-[60vh] flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]"
					>
						<SheetHeader className="text-left flex-shrink-0">
							<SheetTitle>Add to playlist</SheetTitle>
							<SheetDescription className="sr-only">
								Add this track to one of your playlists
							</SheetDescription>
						</SheetHeader>
					<AddToPlaylistMenu
						trackId={track.id}
						trackTitle={track.title}
					/>
					</SheetContent>
				</Sheet>
				<SleepTimerControl
						sleepTimerLabel={sleepTimerLabel}
						onStart={onStartSleepTimer}
						onClear={onClearSleepTimer}
						triggerClassName="h-11 w-11 p-0"
					/>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setIsOverflowOpen(true)}
						aria-label="More actions"
						className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
						title="More actions"
					>
						<Icon name="dots-horizontal" className="h-4 w-4" />
					</Button>
				</div>
			</SheetContent>
		</Sheet>

		<Sheet open={isOverflowOpen} onOpenChange={setIsOverflowOpen}>
			<SheetContent
				side="bottom"
				className="flex flex-col gap-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
			>
				<SheetHeader className="text-left">
					<SheetTitle>Track actions</SheetTitle>
					<SheetDescription className="sr-only">
						Additional actions for the current track
					</SheetDescription>
				</SheetHeader>
			<div className="flex flex-col gap-1">
				<button
					type="button"
					onClick={handlePlayNext}
					className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
				>
					<Icon name="play" className="h-5 w-5" />
					<span className="text-sm">Play Next</span>
				</button>
				<button
					type="button"
					onClick={handleAddToUpNext}
					className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
				>
					<Icon name="arrow-right" className="h-5 w-5" />
					<span className="text-sm">Add to Up Next</span>
				</button>
				<button
					type="button"
					onClick={handleAddToQueue}
					className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
				>
					<Icon name="list-bullet" className="h-5 w-5" />
					<span className="text-sm">Add to Queue</span>
				</button>
				<button
					type="button"
					onClick={() => { setIsOverflowOpen(false); setIsDetailsOpen(true) }}
					className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
				>
					<Icon name="eye-open" className="h-5 w-5" />
					<span className="text-sm">Track Details</span>
				</button>
				<button
					type="button"
					onClick={() => { onDownload(); setIsOverflowOpen(false) }}
					disabled={isDownloading}
					className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors disabled:opacity-50"
				>
					<Icon
						name={isDownloading ? 'arrow-path' : 'download'}
						className={`h-5 w-5 ${isDownloading ? 'animate-spin' : ''}`}
					/>
					<span className="text-sm">Download</span>
				</button>
			</div>
			</SheetContent>
		</Sheet>

		<TrackDetailsDialog
			trackId={track.id}
			open={isDetailsOpen}
			onOpenChange={setIsDetailsOpen}
		/>
		</>
	)
}

function PlayerDesktopBar({
	track,
	isPlaying,
	isAudioLoading,
	currentTime,
	duration,
	loopMode,
	isShuffleEnabled,
	isDownloading,
	sleepTimerLabel,
	hasNext,
	hasPrevious,
	isMuted,
	volume,
	onPrevious,
	onNext,
	onTogglePlayPause,
	onToggleLoop,
	onToggleShuffle,
	onClose,
	onDownload,
	onSeek,
	onSeekStart,
	onSeekEnd,
	onVolumeChange,
	onToggleMute,
	onStartSleepTimer,
	onClearSleepTimer,
}: PlayerChromeProps) {
	return (
		<div className="hidden min-w-0 items-center gap-4 md:flex" data-testid="player-desktop-bar">
			<div className="flex min-w-0 flex-1 max-w-xs items-center gap-3 lg:max-w-sm">
				<TrackThumbnail
					coverImage={track.coverImage}
					alt={track.title}
					size="lg"
					className="shadow-md shrink-0"
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold">{track.title}</p>
					<p className="truncate text-xs text-muted-foreground">{track.artist.name}</p>
				</div>
			</div>

			<div className="flex min-w-0 max-w-2xl flex-1 flex-col items-center gap-2">
				<PlayerTransportControls
					isPlaying={isPlaying}
					isAudioLoading={isAudioLoading}
					hasNext={hasNext}
					hasPrevious={hasPrevious}
					onPrevious={onPrevious}
					onNext={onNext}
					onTogglePlayPause={onTogglePlayPause}
				/>
				<PlayerSeekBar
					currentTime={currentTime}
					duration={duration}
					onSeek={onSeek}
					onSeekStart={onSeekStart}
					onSeekEnd={onSeekEnd}
				/>
			</div>

			<div className="hidden items-center gap-2 md:flex">
				<Button
					variant="ghost"
					size="sm"
					onClick={onToggleMute}
					aria-label={isMuted ? 'Unmute' : 'Mute'}
					className="h-8 w-8 p-0"
					title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
				>
					<Icon
						name={isMuted || volume === 0 ? 'speaker-x-mark' : 'speaker-wave'}
						className="h-4 w-4"
					/>
				</Button>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={isMuted ? 0 : volume}
					onChange={onVolumeChange}
					className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
					aria-label="Volume"
				/>
			</div>
			<SleepTimerControl
				sleepTimerLabel={sleepTimerLabel}
				onStart={onStartSleepTimer}
				onClear={onClearSleepTimer}
			/>
			<div className="flex shrink-0 items-center gap-1">
				<QueueSheet />
				<PlayerLoopShuffleDownload
					loopMode={loopMode}
					isShuffleEnabled={isShuffleEnabled}
					isDownloading={isDownloading}
					onToggleLoop={onToggleLoop}
					onToggleShuffle={onToggleShuffle}
					onDownload={onDownload}
				/>
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
	)
}

interface AudioPlayerProps {
	track: Track | null
	isVisible: boolean
	onClose: () => void
	onStartQueuePlayback?: () => void
	hasQueuedPlayback?: boolean
	onNext: () => void
	onPrevious: () => void
	onToggleLoop: () => void
	onToggleShuffle: () => void
	hasNext: boolean
	hasPrevious: boolean
	loopMode: 'off' | 'all' | 'one'
	isShuffleEnabled: boolean
	playbackToken?: number
	wantsAutoPlayRef?: React.MutableRefObject<boolean>
}

export function AudioPlayer(props: AudioPlayerProps) {
	const {
		track,
		isVisible,
		onClose,
		onStartQueuePlayback,
		hasQueuedPlayback = false,
		onNext,
		onPrevious,
		onToggleLoop,
		onToggleShuffle,
		hasNext,
		hasPrevious,
		loopMode,
		isShuffleEnabled,
		playbackToken = 0,
		wantsAutoPlayRef,
	} = props
	const audioRef = useRef<HTMLAudioElement>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentTime, setCurrentTime] = useState(0)
	const [duration, setDuration] = useState(0)
	const [volume, setVolume] = useState(DEFAULT_PLAYER_VOLUME)
	const [isMuted, setIsMuted] = useState(false)
	const preMuteVolumeRef = useRef(DEFAULT_PLAYER_VOLUME)
	const [sleepTimerEndAt, setSleepTimerEndAt] = useState<number | null>(null)
	const [sleepTimerLabel, setSleepTimerLabel] = useState<string | null>(null)
	const previousPlaybackTokenRef = useRef<number | null>(null)
	const previousTrackIdRef = useRef<string | null>(null)
	const loadedTrackIdRef = useRef<string | null>(null)
	const isManualPlayRef = useRef(false)
	const [isDownloading, setIsDownloading] = useState(false)
	const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false)
	const isOnline = useOnlineStatus()

	useEffect(() => {
		setVolume(readStoredVolume())
	}, [])

	useEffect(() => {
		return () => {
			clearBlobUrlCache()
		}
	}, [])
	
	const audioFile = track?.audioFiles?.length
		? selectBestAudioFile(track.audioFiles)
		: null
	const [audioSrc, setAudioSrc] = useState<string | undefined>(undefined)
	const [playbackError, setPlaybackError] = useState<string | null>(null)
	
	useEffect(() => {
		if (!audioFile || !track) {
			loadedTrackIdRef.current = null
			setAudioSrc(undefined)
			setPlaybackError(null)
			return
		}

		const trackId = track.id
		loadedTrackIdRef.current = null
		setAudioSrc(undefined)
		setPlaybackError(null)

		let cancelled = false
		void resolveTrackPlaybackSource(trackId)
			.then((url) => {
				if (cancelled) return
				if (url) {
					loadedTrackIdRef.current = trackId
					setAudioSrc(url)
					setPlaybackError(null)
				} else {
					setPlaybackError(
						'This track is not available offline. Download it while you still have a connection.',
					)
				}
			})
			.catch((err) => {
				console.error('Failed to resolve audio URL:', err)
				if (!cancelled) {
					setAudioSrc(undefined)
					setPlaybackError('Playback failed. Try downloading this track for offline listening.')
				}
			})

		return () => {
			cancelled = true
			revokePlaybackAudioUrl(trackId)
		}
	}, [audioFile, track?.id, isOnline])

	useEffect(() => {
		if (
			audioRef.current &&
			track &&
			audioSrc &&
			loadedTrackIdRef.current === track.id &&
			playbackToken !== previousPlaybackTokenRef.current
		) {
			previousPlaybackTokenRef.current = playbackToken
			setIsPlaying(false)
			setCurrentTime(0)
			if (track.id !== previousTrackIdRef.current) {
				previousTrackIdRef.current = track.id
				setDuration(0)
			} else if (
				audioRef.current.duration &&
				isFinite(audioRef.current.duration) &&
				audioRef.current.duration > 0
			) {
				setDuration(audioRef.current.duration)
			}
			audioRef.current.volume = isMuted ? 0 : volume
			const shouldAutoPlay = wantsAutoPlayRef?.current || !isManualPlayRef.current
			if (wantsAutoPlayRef) {
				wantsAutoPlayRef.current = false
			}
			if (shouldAutoPlay) {
				audioRef.current.currentTime = 0
				const playPromise = audioRef.current.play()
				if (playPromise !== undefined) {
					playPromise
						.then(() => {
							setIsPlaying(true)
						})
						.catch(() => {
							setIsPlaying(false)
							setPlaybackError(
								'Autoplay was prevented by your browser. Press play to start.',
							)
							toast({
								title: 'Autoplay blocked',
								description: 'Your browser prevented automatic playback. Press play to start listening.',
							})
						})
				}
			}
			isManualPlayRef.current = false
		}
	}, [track?.id, audioSrc, playbackToken, volume, isMuted])

	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.volume = isMuted ? 0 : volume
		}
		writeStoredVolume(volume)
	}, [volume, isMuted])

	const togglePlayPause = useCallback(async () => {
		if (!audioRef.current) return

		const wasPlaying = !audioRef.current.paused
		isManualPlayRef.current = true

		try {
			if (wasPlaying) {
				audioRef.current.pause()
			} else {
				await audioRef.current.play()
			}
		} catch (error) {
			setIsPlaying(!audioRef.current.paused)
			setPlaybackError(
				'Unable to play this track. Try again or check your connection.',
			)
			toast({
				title: 'Playback failed',
				description: 'Could not start playback. Please try again.',
				variant: 'destructive',
			})
		}
	}, [])

	useEffect(() => {
		if (!isVisible) return

		const handleKeyDown = (event: KeyboardEvent) => {
			const action = getPlayerKeyboardAction(event)
			if (!action) return

			event.preventDefault()

			switch (action) {
				case 'toggle-play-pause':
					void togglePlayPause()
					break
				case 'next':
					if (hasNext) onNext()
					break
				case 'previous':
					if (hasPrevious) onPrevious()
					break
				case 'volume-up':
					setIsMuted(false)
					setVolume((current) => adjustVolumeStep(current, 'up'))
					break
				case 'volume-down':
					setIsMuted(false)
					setVolume((current) => adjustVolumeStep(current, 'down'))
					break
				case 'mute-toggle':
					setIsMuted((current) => {
						if (current) {
							setVolume(preMuteVolumeRef.current || DEFAULT_PLAYER_VOLUME)
							return false
						}
						preMuteVolumeRef.current = volume
						return true
					})
					break
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [hasNext, hasPrevious, isVisible, onNext, onPrevious, togglePlayPause, volume])

	useEffect(() => {
		if (!isMediaSessionSupported() || !track || !isVisible) return

		navigator.mediaSession.metadata = new MediaMetadata(
			buildMediaSessionMetadata(track),
		)

		navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'

		navigator.mediaSession.setActionHandler('play', () => {
			if (audioRef.current?.paused) {
				void audioRef.current.play()
			}
		})
		navigator.mediaSession.setActionHandler('pause', () => {
			if (audioRef.current && !audioRef.current.paused) {
				audioRef.current.pause()
			}
		})
		navigator.mediaSession.setActionHandler('previoustrack', () => {
			if (hasPrevious) onPrevious()
		})
		navigator.mediaSession.setActionHandler('nexttrack', () => {
			if (hasNext) onNext()
		})
		navigator.mediaSession.setActionHandler('seekto', (details) => {
			const audio = audioRef.current
			if (!audio || details.seekTime == null) return

			const trackDuration = audio.duration
			if (!trackDuration || !isFinite(trackDuration) || trackDuration <= 0) {
				return
			}

			audio.currentTime = clampMediaSessionSeekTime(
				details.seekTime,
				trackDuration,
			)
			updateMediaSessionPositionState(audio)
		})
		navigator.mediaSession.setActionHandler('stop', () => {
			const audio = audioRef.current
			if (audio && !audio.paused) {
				audio.pause()
			}
			clearMediaSessionPositionState()
		})

		const audio = audioRef.current
		if (audio) {
			updateMediaSessionPositionState(audio)
		}

		return () => {
			navigator.mediaSession.setActionHandler('play', null)
			navigator.mediaSession.setActionHandler('pause', null)
			navigator.mediaSession.setActionHandler('previoustrack', null)
			navigator.mediaSession.setActionHandler('nexttrack', null)
			navigator.mediaSession.setActionHandler('seekto', null)
			navigator.mediaSession.setActionHandler('stop', null)
			clearMediaSessionPositionState()
		}
	}, [hasNext, hasPrevious, isPlaying, isVisible, onNext, onPrevious, track])

	useEffect(() => {
		if (sleepTimerEndAt === null) {
			setSleepTimerLabel(null)
			return undefined
		}

		const updateLabel = () => {
			if (isSleepTimerExpired(sleepTimerEndAt)) {
				setSleepTimerEndAt(null)
				setSleepTimerLabel(null)
				if (audioRef.current) {
					audioRef.current.pause()
				}
				setIsPlaying(false)
				toast({
					title: 'Sleep timer ended',
					description: 'Playback has been stopped.',
				})
				return
			}

			setSleepTimerLabel(formatSleepTimerRemaining(sleepTimerEndAt))
		}

		updateLabel()
		const intervalId = window.setInterval(updateLabel, 1000)
		return () => window.clearInterval(intervalId)
	}, [sleepTimerEndAt])

	const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const nextVolume = Number.parseFloat(event.target.value)
		if (Number.isNaN(nextVolume)) return
		setIsMuted(false)
		setVolume(nextVolume)
	}

	const toggleMute = () => {
		setIsMuted((current) => {
			if (current) {
				setVolume(preMuteVolumeRef.current || DEFAULT_PLAYER_VOLUME)
				return false
			}
			preMuteVolumeRef.current = volume
			return true
		})
	}

	const startSleepTimer = useCallback((minutes: number) => {
		setSleepTimerEndAt(createSleepTimerEndAt(minutes))
		toast({
			title: 'Sleep timer set',
			description: `Playback will stop in ${minutes} minutes.`,
		})
	}, [])

	const clearSleepTimer = useCallback(() => {
		setSleepTimerEndAt(null)
		setSleepTimerLabel(null)
	}, [])
	
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
				updateMediaSessionPositionState(audio)
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
			updateMediaSessionPositionState(audio)
		}
		const handleLoadedMetadata = () => {
			if (audioRef.current) {
				const newDuration = audioRef.current.duration
				if (!isNaN(newDuration) && isFinite(newDuration) && newDuration > 0) {
					setDuration(newDuration)
					updateMediaSessionPositionState(audioRef.current)
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
		const handleError = () => {
			const audio = audioRef.current
			if (audio?.error) {
				console.error(
					`Audio load error: ${audio.error.message} (code: ${audio.error.code})`,
				)
				setPlaybackError(getMediaErrorMessage(audio.error.code))
				setAudioSrc(undefined)
			}
		}
		
		audio.addEventListener('timeupdate', updateTime)
		audio.addEventListener('loadedmetadata', handleLoadedMetadata)
		audio.addEventListener('play', handlePlay)
		audio.addEventListener('pause', handlePause)
		audio.addEventListener('seeking', handleSeeking)
		audio.addEventListener('seeked', handleSeeked)
		audio.addEventListener('ended', handleEnded)
		audio.addEventListener('error', handleError)
		
		return () => {
			audio.removeEventListener('timeupdate', updateTime)
			audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
			audio.removeEventListener('play', handlePlay)
			audio.removeEventListener('pause', handlePause)
			audio.removeEventListener('seeking', handleSeeking)
			audio.removeEventListener('seeked', handleSeeked)
			audio.removeEventListener('ended', handleEnded)
			audio.removeEventListener('error', handleError)
		}
	}, [onNext, loopMode, track, audioSrc])
	
	const handleDownload = async () => {
		if (!track) return
		setIsDownloading(true)
		try {
			const response = await fetch(`/resources/audio/${track.id}/download-url`)
			if (!response.ok) {
				throw new Error(`Failed to get download URL: ${response.status}`)
			}
			const { fileName } = await response.json() as { fileName: string }

			await triggerBrowserDownload(
				`/resources/audio/${track.id}?stream=1`,
				fileName,
			)
		} catch (error) {
			console.error('Download failed:', error)
			toast({
				title: 'Download failed',
				description: error instanceof Error ? error.message : 'Could not download track',
				variant: 'destructive',
			})
		} finally {
			setIsDownloading(false)
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
			updateMediaSessionPositionState(audio)
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

	if (!isVisible) {
		return null
	}

	if (!track) {
		return (
			<QueueOnlyPlayerBar
				onClose={onClose}
				onStartPlayback={onStartQueuePlayback}
				hasQueuedPlayback={hasQueuedPlayback}
			/>
		)
}

const isAudioLoading = !audioSrc
	const chromeProps: PlayerChromeProps = {
		track,
		isPlaying,
		isAudioLoading,
		currentTime,
		duration,
		loopMode,
		isShuffleEnabled,
		isDownloading,
		sleepTimerLabel,
		hasNext,
		hasPrevious,
		isMuted,
		volume,
		onPrevious,
		onNext,
		onTogglePlayPause: togglePlayPause,
		onToggleLoop,
		onToggleShuffle,
		onClose,
		onDownload: handleDownload,
		onSeek: handleSeek,
		onSeekStart: handleSeekStart,
		onSeekEnd: handleSeekEnd,
		onVolumeChange: handleVolumeChange,
		onToggleMute: toggleMute,
		onStartSleepTimer: startSleepTimer,
		onClearSleepTimer: clearSleepTimer,
	}

	return (
		<div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
			{playbackError ? (
				<div
					data-testid="player-playback-error"
					className="px-4 py-3 text-sm text-destructive"
				>
					<p className="container">{playbackError}</p>
				</div>
			) : null}
			<PlayerMiniBar
				{...chromeProps}
				onOpenNowPlaying={() => setIsNowPlayingOpen(true)}
			/>
			<PlayerNowPlayingSheet
				{...chromeProps}
				open={isNowPlayingOpen}
				onOpenChange={setIsNowPlayingOpen}
			/>
			<div className="container mx-auto hidden px-4 py-3 md:block">
				<PlayerDesktopBar {...chromeProps} />
			</div>

			<audio
				ref={audioRef}
				src={audioSrc}
				loop={loopMode === 'one'}
				preload="metadata"
			/>
		</div>
	)
}

/**
 * Minimal player chrome when the queue has items but nothing is playing yet (cold queue actions).
 */
function QueueOnlyPlayerBar({
	onClose,
	onStartPlayback,
	hasQueuedPlayback,
}: {
	onClose: () => void
	onStartPlayback?: () => void
	hasQueuedPlayback: boolean
}) {
	return (
		<div
			className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
			data-testid="player-queue-only-bar"
		>
			<div className="md:hidden">
				<div className="flex items-center gap-2 px-3 py-2">
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold">Queue ready</p>
						<p className="truncate text-xs text-muted-foreground">
							Press play to start listening
						</p>
					</div>
					<Button
						variant="default"
						size="lg"
						onClick={onStartPlayback}
						disabled={!hasQueuedPlayback}
						aria-label="Play"
						className="h-11 w-11 shrink-0 rounded-full p-0"
					>
						<Icon name="play" className="ml-0.5 h-5 w-5" />
					</Button>
					<QueueSheet triggerClassName="h-11 w-11 shrink-0 p-0" />
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						aria-label="Close player"
						className="h-11 w-11 shrink-0 p-0"
					>
						<Icon name="x-mark" className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<div className="container mx-auto hidden items-center justify-between gap-4 px-4 py-3 md:flex">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold">Queue ready</p>
					<p className="truncate text-xs text-muted-foreground">
						Press play to start listening
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="default"
						size="lg"
						onClick={onStartPlayback}
						disabled={!hasQueuedPlayback}
						aria-label="Play"
						className="h-10 w-10 rounded-full p-0"
					>
						<Icon name="play" className="ml-0.5 h-5 w-5" />
					</Button>
					<QueueSheet />
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
		</div>
	)
}

/**
 * Bottom sheet showing the three-zone queue: Now playing, Up Next, and spine.
 */
const UP_NEXT_VIRTUAL_THRESHOLD = 20
const SPINE_VIRTUAL_THRESHOLD = 20

function QueueSectionHeading({ children }: { children: ReactNode }) {
	return (
		<h3 className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
			{children}
		</h3>
	)
}

function VirtualQueueTrackList({
	tracks,
	onRemoveTrack,
	parentRef,
	hydrateTracksForDisplay,
}: {
	tracks: Track[]
	onRemoveTrack: (index: number) => void
	parentRef: React.RefObject<HTMLDivElement | null>
	hydrateTracksForDisplay: (ids: string[]) => void
}) {
	const [scrollReadyEpoch, setScrollReadyEpoch] = useState(0)

	useLayoutEffect(() => {
		const scrollElement = parentRef.current
		if (!scrollElement) return

		let hasMeasured = scrollElement.clientHeight > 0
		const markMeasured = () => {
			if (hasMeasured) return
			if ((parentRef.current?.clientHeight ?? 0) <= 0) return
			hasMeasured = true
			setScrollReadyEpoch(epoch => epoch + 1)
		}

		markMeasured()
		const observer = new ResizeObserver(markMeasured)
		observer.observe(scrollElement)
		const frame = requestAnimationFrame(markMeasured)

		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
		}
	}, [parentRef, tracks.length])

	const virtualizer = useVirtualizer({
		count: tracks.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 60,
		overscan: 10,
		rangeExtractor: defaultRangeExtractor,
	})
	void scrollReadyEpoch

	const virtualItems = virtualizer.getVirtualItems()

	const visibleTrackKey = useMemo(() => {
		if (virtualItems.length > 0) {
			return virtualItems.map(item => item.index).join(',')
		}
		return tracks
			.slice(0, 30)
			.map((_, index) => index)
			.join(',')
	}, [virtualItems, tracks.length])

	useEffect(() => {
		const indices =
			visibleTrackKey.length > 0
				? visibleTrackKey.split(',').map(index => Number.parseInt(index, 10))
				: tracks.slice(0, 30).map((_, index) => index)

		const visibleTracks = indices
			.map(index => tracks[index])
			.filter((track): track is Track => track !== undefined)

		hydrateTracksForDisplay(visibleTracks.map(track => track.id))
	}, [visibleTrackKey, tracks, hydrateTracksForDisplay, scrollReadyEpoch])

	if (virtualItems.length === 0 && tracks.length > 0) {
		return (
			<>
				{tracks.slice(0, 30).map((track, index) => (
					<QueueTrackItem
						key={`${track.id}-${index}`}
						track={track}
						isCurrentlyPlaying={false}
						onRemove={() => onRemoveTrack(index)}
					/>
				))}
			</>
		)
	}

	return (
		<div
			style={{
				height: `${virtualizer.getTotalSize()}px`,
				width: '100%',
				position: 'relative',
			}}
		>
			{virtualItems.map(virtualItem => {
				const track = tracks[virtualItem.index]
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
							isCurrentlyPlaying={false}
							onRemove={() => onRemoveTrack(virtualItem.index)}
						/>
					</div>
				)
			})}
		</div>
	)
}

function QueueSheet({ triggerClassName = 'h-8 w-8 p-0' }: { triggerClassName?: string }) {
	const {
		upNext,
		spine,
		spineTotal,
		spinePosition,
		currentTrack,
		playContext,
		removeTrackFromPlaylist,
		removeCurrentFromQueue,
		hydrateTracksForDisplay,
	} = useAudioPlayer()
	const upNextScrollRef = useRef<HTMLDivElement>(null)
	const spineScrollRef = useRef<HTMLDivElement>(null)
	const [isOpen, setIsOpen] = useState(false)

	const queueSheetTrackIds = useMemo(() => {
		const ids: string[] = []
		if (currentTrack) ids.push(currentTrack.id)
		ids.push(...upNext.map(track => track.id))
		if (spine.length < SPINE_VIRTUAL_THRESHOLD) {
			ids.push(...spine.map(track => track.id))
		}
		return ids.join(',')
	}, [currentTrack?.id, upNext, spine])

	useEffect(() => {
		if (!isOpen || queueSheetTrackIds.length === 0) return
		hydrateTracksForDisplay(queueSheetTrackIds.split(','))
	}, [isOpen, queueSheetTrackIds, hydrateTracksForDisplay])

	const spineLabel = getSpineSectionLabel(playContext)
	const sheetTitle = formatQueueSheetTitle(upNext.length, spineTotal, spineLabel)
	const spineHeading = getSpineSectionHeading(playContext)
	const isEmpty =
		!currentTrack && upNext.length === 0 && spine.length === 0 && spineTotal === 0

	const removeUpNextTrack = useCallback(
		(index: number) => {
			removeTrackFromPlaylist({ zone: 'upNext', index })
		},
		[removeTrackFromPlaylist],
	)

	const removeSpineTrack = useCallback(
		(displayIndex: number) => {
			removeTrackFromPlaylist({
				zone: 'spine',
				index: spinePosition + 1 + displayIndex,
			})
		},
		[removeTrackFromPlaylist, spinePosition],
	)

	const removeCurrentTrack = useCallback(() => {
		removeCurrentFromQueue()
	}, [removeCurrentFromQueue])

	return (
		<Sheet open={isOpen} onOpenChange={setIsOpen}>
			<SheetTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={triggerClassName}
					title="Queue"
					aria-label="Open queue"
				>
					<Icon name="list-bullet" className="h-4 w-4" />
				</Button>
			</SheetTrigger>
			<SheetContent side="bottom" className="h-[80vh] flex flex-col">
				<SheetHeader className="flex-shrink-0">
					<SheetTitle>{sheetTitle}</SheetTitle>
					<SheetDescription className="sr-only">
						Upcoming tracks grouped by now playing, up next, and library or playlist source
					</SheetDescription>
				</SheetHeader>
				<div className="flex-1 mt-6 min-h-0 flex flex-col gap-4">
					{isEmpty ? (
						<div className="text-center py-12">
							<Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
							<h3 className="text-lg font-semibold mb-2">Queue is Empty</h3>
							<p className="text-muted-foreground">
								Add tracks to your queue to see them here.
							</p>
						</div>
					) : (
						<>
							{currentTrack ? (
								<section>
									<QueueSectionHeading>Now playing</QueueSectionHeading>
									<QueueTrackItem
										track={currentTrack}
										isCurrentlyPlaying
										onRemove={removeCurrentTrack}
									/>
								</section>
							) : null}

							{upNext.length > 0 ? (
								<section
									className={
										upNext.length >= UP_NEXT_VIRTUAL_THRESHOLD
											? 'flex-1 min-h-0 flex flex-col'
											: undefined
									}
								>
									<QueueSectionHeading>Up Next</QueueSectionHeading>
									{upNext.length >= UP_NEXT_VIRTUAL_THRESHOLD ? (
										<div
											ref={upNextScrollRef}
											className="flex-1 w-full min-h-0 overflow-y-auto"
										>
											{isOpen ? (
												<VirtualQueueTrackList
													tracks={upNext}
													onRemoveTrack={removeUpNextTrack}
													parentRef={upNextScrollRef}
													hydrateTracksForDisplay={hydrateTracksForDisplay}
												/>
											) : null}
										</div>
									) : (
										upNext.map((track, index) => (
											<QueueTrackItem
												key={`${track.id}-${index}`}
												track={track}
												isCurrentlyPlaying={false}
												onRemove={() => removeUpNextTrack(index)}
											/>
										))
									)}
								</section>
							) : null}

							{spine.length > 0 || spineTotal > 0 ? (
								<section className="flex-1 min-h-0 flex flex-col">
									<QueueSectionHeading>{spineHeading}</QueueSectionHeading>
									{spine.length > 0 ? (
										spine.length >= SPINE_VIRTUAL_THRESHOLD ? (
											<div
												ref={spineScrollRef}
												className="flex-1 w-full min-h-0 overflow-y-auto"
											>
												{isOpen ? (
													<VirtualQueueTrackList
														tracks={spine}
														onRemoveTrack={removeSpineTrack}
														parentRef={spineScrollRef}
														hydrateTracksForDisplay={hydrateTracksForDisplay}
													/>
												) : null}
											</div>
										) : (
											spine.map((track, index) => (
												<QueueTrackItem
													key={`${track.id}-${index}`}
													track={track}
													isCurrentlyPlaying={false}
													onRemove={() => removeSpineTrack(index)}
												/>
											))
										)
									) : (
										<p className="px-4 py-3 text-sm text-muted-foreground">
											No more tracks in this queue.
										</p>
									)}
								</section>
							) : null}
						</>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}

function SleepTimerControl({
	sleepTimerLabel,
	onStart,
	onClear,
	triggerClassName = 'h-8 px-2',
}: {
	sleepTimerLabel: string | null
	onStart: (minutes: number) => void
	onClear: () => void
	triggerClassName?: string
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn(triggerClassName, sleepTimerLabel ? 'text-primary bg-primary/10' : '')}
					aria-label="Sleep timer"
					title="Sleep timer"
				>
					<Icon name="moon" className="h-4 w-4" />
					{sleepTimerLabel ? (
						<span className="ml-1 text-xs tabular-nums">{sleepTimerLabel}</span>
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-56 space-y-3">
				<div>
					<p className="text-sm font-medium">Sleep timer</p>
					<p className="text-xs text-muted-foreground">
						Stop playback after the selected time.
					</p>
				</div>
				<div className="grid grid-cols-2 gap-2">
					{SLEEP_TIMER_PRESETS_MINUTES.map((minutes) => (
						<Button
							key={minutes}
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onStart(minutes)}
						>
							{minutes} min
						</Button>
					))}
				</div>
				{sleepTimerLabel ? (
					<Button type="button" variant="ghost" size="sm" onClick={onClear}>
						Cancel timer
					</Button>
				) : null}
			</PopoverContent>
		</Popover>
	)
}

function QueueTrackItem({ track, isCurrentlyPlaying, onRemove }: { track: Track, isCurrentlyPlaying: boolean, onRemove: () => void }) {
	const coverImage = 'coverImage' in track ? track.coverImage : null

	return (
		<div className={`group flex items-center gap-3 px-4 py-3 rounded-md hover:bg-muted/50 transition-colors ${
			isCurrentlyPlaying ? 'bg-primary/10 border-l-4 border-primary' : ''
		}`}>
			<div className="flex-shrink-0 relative">
				<TrackThumbnail 
					coverImage={coverImage}
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
					{track.artist.name}
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
