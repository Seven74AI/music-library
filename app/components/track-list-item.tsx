import { useState, useCallback, memo } from 'react'
import { NavLink } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '#app/components/ui/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '#app/components/ui/dropdown-menu.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#app/components/ui/sheet.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip'
import { useAudioPlayer } from '#app/components/audio-player-provider'
import { downloadTrack } from '#app/utils/download.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { useIsMobile } from '#app/utils/use-mobile.ts'
import { AddToPlaylistMenu } from './add-to-playlist-menu'

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
	serviceUrl: string | null
	audioFile?: {
		objectKey: string | null
		fileSize: number | null
		status: string
	} | null
	service?: {
		displayName: string
		logoUrl: string | null
	} | null
}

interface UserTrack {
	createdAt: string | Date
}

interface TrackListItemProps {
	track: Track
	userTrack: UserTrack
	index: number
	playlistContext?: {
		type: 'library' | 'playlist' | 'music'
		playlistId?: string
	}
	showSyncActions?: boolean
	isInUserLibrary?: boolean
	onAddToLibrary?: (trackId: string) => void
	onRemoveFromLibrary?: (trackId: string) => void
	showQueueActions?: boolean
	onRemoveFromQueue?: (trackId: string) => void
	playlists?: Array<{ id: string; title: string; description: string | null; _count: { tracks: number } }>
}

/**
 * Individual track list item component with responsive menu system
 * 
 * On mobile: Uses bottom sheets for track actions (Spotify-like UX)
 * On desktop: Uses dropdown menus for track actions
 * 
 * Features:
 * - Play/pause functionality with visual feedback
 * - Track thumbnail and metadata display
 * - Responsive action menu (sheet on mobile, dropdown on desktop)
 * - Add to playlist functionality with duplicate detection
 * - Download and external link actions
 * 
 * @param track - Track data including title, artist, duration, etc.
 * @param userTrack - User-specific track data (creation date, etc.)
 * @param index - Position in the list (for numbering)
 * @param playlistContext - Context for playlist-specific actions
 * @param showSyncActions - Whether to show sync-related actions
 * @param isInUserLibrary - Whether track is in user's library
 * @param onAddToLibrary - Callback for adding track to library
 * @param onRemoveFromLibrary - Callback for removing track from library
 * @param showQueueActions - Whether to show queue-related actions
 * @param onRemoveFromQueue - Callback for removing track from queue
 * @param playlists - Available playlists for "Add to Playlist" functionality
 * 
 * @example
 * ```tsx
 * <TrackListItem
 *   track={trackData}
 *   userTrack={userTrackData}
 *   index={0}
 *   playlists={userPlaylists}
 *   showSyncActions={true}
 * />
 * ```
 */
export const TrackListItem = memo(function TrackListItem({ track, userTrack, index, playlistContext, showSyncActions, isInUserLibrary, onAddToLibrary, onRemoveFromLibrary, showQueueActions, onRemoveFromQueue, playlists }: TrackListItemProps) {
	const [isHovered, setIsHovered] = useState(false)
	const [isActionsSheetOpen, setIsActionsSheetOpen] = useState(false)
	const [isPlaylistSheetOpen, setIsPlaylistSheetOpen] = useState(false)
	const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false)
	const isMobile = useIsMobile()
	const { currentTrack, currentIndex, playTrack, playNextTrack, addToCurrentPlaylist } = useAudioPlayer()

	const handleClick = useCallback((event: React.MouseEvent) => {
		event.stopPropagation()
	}, [])

	const handleDownload = useCallback(() => {
		void downloadTrack(track.id, `${track.title}.mp3`)
	}, [track.id, track.title])

	const handlePlayPause = useCallback(() => {
		// If this track is currently playing, we could pause it
		// For now, we'll just play this track
		if (track.audioFile?.objectKey && track.audioFile.status === 'completed') {
			const context = playlistContext || { type: 'library' as const }
			playTrack(track, context, index)
		}
		// If audio is not available, the button will be disabled and show a tooltip
	}, [track, index, playTrack, playlistContext])

	const handlePlayNext = useCallback(() => {
		if (track.audioFile?.objectKey && track.audioFile.status === 'completed') {
			playNextTrack(track)
		}
	}, [track, playNextTrack])

	const handleAddToQueue = useCallback(() => {
		addToCurrentPlaylist(track)
	}, [track, addToCurrentPlaylist])

	const handleAddToLibrary = useCallback(() => {
		if (onAddToLibrary) {
			onAddToLibrary(track.id)
		}
	}, [track.id, onAddToLibrary])

	const handleRemoveFromLibrary = useCallback(() => {
		if (onRemoveFromLibrary) {
			onRemoveFromLibrary(track.id)
		}
	}, [track.id, onRemoveFromLibrary])

	const handleRemoveFromQueue = useCallback(() => {
		if (onRemoveFromQueue) {
			onRemoveFromQueue(track.id)
		}
	}, [track.id, onRemoveFromQueue])

	const handleOpenPlaylistSheet = useCallback(() => {
		setIsActionsSheetOpen(false)
		setIsPlaylistSheetOpen(true)
	}, [])

	const handlePlaylistSuccess = useCallback(() => {
		setIsPlaylistSheetOpen(false)
	}, [])

	const handleOpenDetailsSheet = useCallback(() => {
		setIsActionsSheetOpen(false)
		setIsDetailsSheetOpen(true)
	}, [])

	// Check if this track is currently playing (both ID and position must match for duplicates)
	const isCurrentlyPlaying = currentTrack?.id === track.id && currentIndex === index
	
	// Check if track has playable audio
	const hasPlayableAudio = Boolean(track.audioFile?.objectKey && track.audioFile.status === 'completed')
	
	// Memoize thumbnail URL to prevent unnecessary re-renders
	const thumbnailUrl = track.thumbnailUrl 
		? `/resources/images?src=${encodeURIComponent(track.thumbnailUrl)}&w=40&h=40&fit=cover&format=webp`
		: null

	return (
		<div 
			className="group flex items-center gap-4 px-4 py-2 rounded-md hover:bg-muted/50 transition-colors h-20"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			role="gridcell"
			aria-label={`Track ${index + 1}: ${track.title} by ${track.artist}`}
		>
			{/* Track Number / Play Button */}
			<div className="w-8 flex items-center justify-center min-w-8">
				{isHovered || isCurrentlyPlaying ? (
					hasPlayableAudio ? (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0 hover:scale-110 transition-transform hover:bg-muted/50 flex items-center justify-center bg-muted/20"
							onClick={handlePlayPause}
							aria-label={isCurrentlyPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
							aria-pressed={isCurrentlyPlaying}
						>
							<Icon 
								name={isCurrentlyPlaying ? "pause" : "play"} 
								className="h-4 w-4 text-foreground" 
								aria-hidden="true"
							/>
						</Button>
					) : (
						<div 
							className="h-8 w-8 flex items-center justify-center bg-muted/20 rounded-md"
							aria-label={`${track.title} is being processed`}
							role="status"
						>
							<Icon 
								name="clock" 
								className="h-4 w-4 text-muted-foreground" 
								aria-hidden="true"
							/>
						</div>
					)
				) : (
					<span 
						className="text-sm text-muted-foreground group-hover:text-foreground transition-colors"
						aria-label={`Track number ${index + 1}`}
					>
						{index + 1}
					</span>
				)}
			</div>

			{/* Track Info */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-3">
					{/* Thumbnail */}
					<div className="flex-shrink-0">
						{thumbnailUrl ? (
							<img 
								src={thumbnailUrl} 
								alt={track.title}
								className="h-10 w-10 rounded object-cover"
								loading="lazy"
							/>
						) : track.audioFile ? (
							<div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
								<Icon name="file-text" className="h-5 w-5 text-muted-foreground" />
							</div>
						) : (
							<div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
								<Icon name="link-2" className="h-5 w-5 text-muted-foreground" />
							</div>
						)}
					</div>

					{/* Title and Artist */}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<div className="font-medium text-sm truncate group-hover:text-foreground transition-colors">
								{track.title}
							</div>
							{track.service?.displayName === 'YouTube' && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex-shrink-0">
											<Icon name="youtube" className="h-4 w-4 text-red-500" />
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>This track comes from YouTube</p>
									</TooltipContent>
								</Tooltip>
							)}
						</div>
						<div className="text-xs text-muted-foreground truncate">
							{track.artist}
						</div>
					</div>
				</div>
			</div>

			{/* Is Saved */}
			{isInUserLibrary !== undefined && (
				<div className="hidden lg:flex items-center justify-center w-20">
					{isInUserLibrary ? (
						<Button
							variant="outline"
							size="sm"
							className="h-6 px-2 text-xs"
							onClick={handleRemoveFromLibrary}
							aria-label={`Remove ${track.title} from library`}
						>
							<Icon name="check" className="h-3 w-3 mr-1" />
							Saved
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs"
							onClick={handleAddToLibrary}
							aria-label={`Add ${track.title} to library`}
						>
							<Icon name="plus" className="h-3 w-3 mr-1" />
							Add
						</Button>
					)}
				</div>
			)}

			{/* Duration */}
			<div className="hidden md:flex text-xs text-muted-foreground w-12 text-center">
				{formatDuration(track.duration || 0)}
			</div>

			{/* Actions */}
			<div className="flex items-center gap-1 w-8">
				{isMobile ? (
					/* Mobile: Bottom Sheet */
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-8 p-0"
						aria-label="More actions"
						onClick={() => setIsActionsSheetOpen(true)}
					>
						<Icon name="dots-horizontal" className="h-4 w-4" />
					</Button>
				) : (
					/* Desktop: Dropdown Menu */
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-8 w-8 p-0"
								aria-label="More actions"
							>
								<Icon name="dots-horizontal" className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<Dialog>
								<DialogTrigger asChild>
									<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
										<Icon name="eye-open" className="h-4 w-4 mr-2" />
										View track details
									</DropdownMenuItem>
								</DialogTrigger>
								<DialogContent className="max-w-md">
									<DialogHeader>
										<DialogTitle className="text-left">
										<div className="flex items-center gap-3">
											{track.thumbnailUrl ? (
												<img
													src={`/resources/images?src=${encodeURIComponent(track.thumbnailUrl)}&w=48&h=48&fit=cover&format=webp`}
													alt={track.title}
													className="h-12 w-12 rounded object-cover"
													loading="lazy"
												/>
											) : (
												<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
													<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
												</div>
											)}
												<div className="min-w-0 flex-1">
													<div className="font-medium text-sm truncate" title={track.title}>
														{track.title}
													</div>
													<div className="text-xs text-muted-foreground truncate" title={track.artist}>
														{track.artist}
													</div>
												</div>
											</div>
										</DialogTitle>
									</DialogHeader>
									<div className="mt-6 space-y-4">
										<div className="space-y-2">
											<div className="text-sm font-medium">Track Information</div>
											<div className="text-sm text-muted-foreground space-y-1">
												<div>Artist: {track.artist}</div>
												<div>Duration: {formatDuration(track.duration || 0)}</div>
												<div>Added: {new Date(userTrack.createdAt).toLocaleDateString()}</div>
												{track.service?.displayName && (
													<div>Source: {track.service.displayName}</div>
												)}
											</div>
										</div>
										<div className="flex gap-2">
											{track.serviceUrl && (
												<Button
													variant="outline"
													size="sm"
													onClick={() => track.serviceUrl && window.open(track.serviceUrl, '_blank')}
													className="flex-1"
												>
													<Icon name="link-2" className="h-4 w-4 mr-2" />
													Open on YouTube
												</Button>
											)}
											{track.audioFile?.objectKey ? (
												<Button
													variant="outline"
													size="sm"
													onClick={handleDownload}
													className="flex-1"
												>
													<Icon name="download" className="h-4 w-4 mr-2" />
													Download
												</Button>
											) : (
												<Button
													variant="outline"
													size="sm"
													disabled
													className="flex-1"
												>
													<Icon name="clock" className="h-4 w-4 mr-2" />
													Processing...
												</Button>
											)}
										</div>
									</div>
								</DialogContent>
							</Dialog>
							{track.serviceUrl && (
								<DropdownMenuItem asChild>
									<a
										href={track.serviceUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center"
									>
										<Icon name="link-2" className="h-4 w-4 mr-2" />
										Open on YouTube
									</a>
								</DropdownMenuItem>
							)}
							{hasPlayableAudio && (
								<DropdownMenuItem onClick={handlePlayNext}>
									<Icon name="play" className="h-4 w-4 mr-2" />
									Play next
								</DropdownMenuItem>
							)}
							{hasPlayableAudio && (
								<DropdownMenuItem onClick={handleAddToQueue}>
									<Icon name="plus" className="h-4 w-4 mr-2" />
									Add to queue
								</DropdownMenuItem>
							)}
							{playlists && playlists.length > 0 && (
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<Icon name="plus" className="h-4 w-4 mr-2" />
										Add to Playlist
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent>
										<AddToPlaylistMenu 
											trackId={track.id} 
											trackTitle={track.title}
											playlists={playlists}
										/>
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							)}
							{track.audioFile?.objectKey ? (
								<DropdownMenuItem onClick={handleDownload}>
									<Icon name="download" className="h-4 w-4 mr-2" />
									Download audio file
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem disabled>
									<Icon name="clock" className="h-4 w-4 mr-2" />
									Audio is being processed
								</DropdownMenuItem>
							)}
							{showSyncActions && (
								<>
									<DropdownMenuItem asChild>
										<NavLink to={`/library?add=${track.id}`}>
											<Icon name="plus" className="h-4 w-4 mr-2" />
											Add to Library
										</NavLink>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<NavLink to={`/library?remove=${track.id}`}>
											<Icon name="trash" className="h-4 w-4 mr-2" />
											Remove from Library
										</NavLink>
									</DropdownMenuItem>
								</>
							)}
							{showQueueActions && (
								<DropdownMenuItem onClick={handleRemoveFromQueue}>
									<Icon name="trash" className="h-4 w-4 mr-2" />
									Remove from Queue
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			
			{/* Mobile Sheets (rendered outside the button) */}
			{isMobile && (
				<>
					{/* Actions Sheet */}
					<Sheet open={isActionsSheetOpen} onOpenChange={setIsActionsSheetOpen}>
						<SheetContent side="bottom" className="h-[60vh]">
							<SheetHeader>
								<SheetTitle className="text-left">
									<div className="flex items-center gap-3">
										{track.thumbnailUrl ? (
											<img
												src={`/resources/images?src=${encodeURIComponent(track.thumbnailUrl)}&w=48&h=48&fit=cover&format=webp`}
												alt={track.title}
												className="h-12 w-12 rounded object-cover"
												loading="lazy"
											/>
										) : (
											<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
												<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
											</div>
										)}
										<div className="min-w-0 flex-1">
											<div className="font-medium text-sm truncate" title={track.title}>
												{track.title}
											</div>
											<div className="text-xs text-muted-foreground truncate" title={track.artist}>
												{track.artist}
											</div>
										</div>
									</div>
								</SheetTitle>
							</SheetHeader>
							<div className="mt-6 space-y-1">
								<Button
									variant="ghost"
									className="w-full justify-start h-12 text-base"
									onClick={handleOpenDetailsSheet}
								>
									<Icon name="eye-open" className="h-5 w-5 mr-3" />
									View track details
								</Button>
								{track.serviceUrl && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										asChild
									>
										<a
											href={track.serviceUrl}
											target="_blank"
											rel="noopener noreferrer"
										>
											<Icon name="link-2" className="h-5 w-5 mr-3" />
											Open on YouTube
										</a>
									</Button>
								)}
								{hasPlayableAudio && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={() => {
											handlePlayNext()
											setIsActionsSheetOpen(false)
										}}
									>
										<Icon name="play" className="h-5 w-5 mr-3" />
										Play next
									</Button>
								)}
								{hasPlayableAudio && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={() => {
											handleAddToQueue()
											setIsActionsSheetOpen(false)
										}}
									>
										<Icon name="plus" className="h-5 w-5 mr-3" />
										Add to queue
									</Button>
								)}
								{playlists && playlists.length > 0 && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={handleOpenPlaylistSheet}
									>
										<Icon name="plus" className="h-5 w-5 mr-3" />
										Add to Playlist
									</Button>
								)}
								{track.audioFile?.objectKey ? (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={() => {
											handleDownload()
											setIsActionsSheetOpen(false)
										}}
									>
										<Icon name="download" className="h-5 w-5 mr-3" />
										Download audio file
									</Button>
								) : (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										disabled
									>
										<Icon name="clock" className="h-5 w-5 mr-3" />
										Audio is being processed
									</Button>
								)}
								{showSyncActions && (
									<>
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											asChild
										>
											<NavLink to={`/library?add=${track.id}`}>
												<Icon name="plus" className="h-5 w-5 mr-3" />
												Add to Library
											</NavLink>
										</Button>
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											asChild
										>
											<NavLink to={`/library?remove=${track.id}`}>
												<Icon name="trash" className="h-5 w-5 mr-3" />
												Remove from Library
											</NavLink>
										</Button>
									</>
								)}
								{showQueueActions && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={() => {
											handleRemoveFromQueue()
											setIsActionsSheetOpen(false)
										}}
									>
										<Icon name="trash" className="h-5 w-5 mr-3" />
										Remove from Queue
									</Button>
								)}
								{isInUserLibrary !== undefined && (
									isInUserLibrary ? (
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											onClick={() => {
												handleRemoveFromLibrary()
												setIsActionsSheetOpen(false)
											}}
										>
											<Icon name="trash" className="h-5 w-5 mr-3" />
											Remove from Library
										</Button>
									) : (
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											onClick={() => {
												handleAddToLibrary()
												setIsActionsSheetOpen(false)
											}}
										>
											<Icon name="plus" className="h-5 w-5 mr-3" />
											Add to Library
										</Button>
									)
								)}
							</div>
						</SheetContent>
					</Sheet>

					{/* Playlist Selection Sheet */}
					<Sheet open={isPlaylistSheetOpen} onOpenChange={setIsPlaylistSheetOpen}>
						<SheetContent side="bottom" className="h-[80vh]">
							<SheetHeader>
								<SheetTitle>Add to Playlist</SheetTitle>
							</SheetHeader>
							<div className="mt-6">
								<AddToPlaylistMenu 
									trackId={track.id} 
									trackTitle={track.title}
									playlists={playlists || []}
									onSuccess={handlePlaylistSuccess}
								/>
							</div>
						</SheetContent>
					</Sheet>

					{/* Track Details Sheet (mobile) */}
					<Sheet open={isDetailsSheetOpen} onOpenChange={setIsDetailsSheetOpen}>
						<SheetContent side="bottom" className="h-[80vh]">
							<SheetHeader>
								<SheetTitle className="text-left">
									<div className="flex items-center gap-3">
										{track.thumbnailUrl ? (
											<img
												src={`/resources/images?src=${encodeURIComponent(track.thumbnailUrl)}&w=48&h=48&fit=cover&format=webp`}
												alt={track.title}
												className="h-12 w-12 rounded object-cover"
												loading="lazy"
											/>
										) : (
											<div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
												<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
											</div>
										)}
										<div className="min-w-0 flex-1">
											<div className="font-medium text-sm truncate" title={track.title}>
												{track.title}
											</div>
											<div className="text-xs text-muted-foreground truncate" title={track.artist}>
												{track.artist}
											</div>
										</div>
									</div>
								</SheetTitle>
							</SheetHeader>
							<div className="mt-6 space-y-4">
								<div className="space-y-2">
									<div className="text-sm font-medium">Track Information</div>
									<div className="text-sm text-muted-foreground space-y-1">
										<div>Artist: {track.artist}</div>
										<div>Duration: {formatDuration(track.duration || 0)}</div>
										<div>Added: {new Date(userTrack.createdAt).toLocaleDateString()}</div>
										{track.service?.displayName && (
											<div>Source: {track.service.displayName}</div>
										)}
									</div>
								</div>
								<div className="flex gap-2">
									{track.serviceUrl && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => track.serviceUrl && window.open(track.serviceUrl, '_blank')}
											className="flex-1"
										>
											<Icon name="link-2" className="h-4 w-4 mr-2" />
											Open on YouTube
										</Button>
									)}
									{track.audioFile?.objectKey ? (
										<Button
											variant="outline"
											size="sm"
											onClick={handleDownload}
											className="flex-1"
										>
											<Icon name="download" className="h-4 w-4 mr-2" />
											Download
										</Button>
									) : (
										<Button
											variant="outline"
											size="sm"
											disabled
											className="flex-1"
										>
											<Icon name="clock" className="h-4 w-4 mr-2" />
											Processing...
										</Button>
									)}
								</div>
							</div>
						</SheetContent>
					</Sheet>

				</>
			)}
		</div>
	)
})
