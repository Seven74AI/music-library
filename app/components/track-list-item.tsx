import { useState, useCallback, memo, type PointerEvent, type ReactNode } from 'react'
import { useAudioPlayer } from '#app/components/audio-player-provider'
import { TrackThumbnail } from '#app/components/track-thumbnail'
import { Button } from '#app/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '#app/components/ui/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#app/components/ui/sheet.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip'
import { toast } from '#app/components/ui/use-toast.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { useIsMobile } from '#app/utils/use-mobile.ts'
import { AddToPlaylistMenu } from './add-to-playlist-menu'

interface TrackListItemData {
	id: string
	title: string
	artist: { id: string; name: string }
	duration: number | null
	coverImage: { objectKey: string } | null
	thumbnailUrl?: string | null // Placeholder thumbnail URL (e.g., from YouTube) when coverImage is not available
	serviceUrl: string | null
	service?: { displayName: string; logoUrl: string | null } | null
	audioFiles?: Array<{ id: string; format: string | null; objectKey: string }>
	isInUserLibrary?: boolean
}

interface UserTrack {
	createdAt: string | Date
}

interface TrackListItemProps {
	track: TrackListItemData
	userTrack: UserTrack
	index: number
	playlistContext?: {
		type: 'library' | 'playlist' | 'music'
		playlistId?: string
	}
	isDeleted?: boolean
	showQueueActions?: boolean
	onRemoveFromQueue?: (trackId: string) => void
	showPlaylistActions?: boolean
	onRemoveFromPlaylist?: (trackId: string) => void
	playlists?: Array<{ id: string; title: string; description: string | null; _count: { tracks: number } }>
	showDuration?: boolean // New prop to control duration display
	/** Render prop for custom per-track action buttons. Receives trackId, isInLibrary, and isDeleted. */
	itemActions?: (props: { trackId: string; isInLibrary: boolean; isDeleted: boolean }) => ReactNode
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
 * - External link actions
 * 
 * @param track - Track data including title, artist, duration, etc.
 * @param userTrack - User-specific track data (creation date, etc.)
 * @param index - Position in the list (for numbering)
 * @param playlistContext - Context for playlist-specific actions
 * @param showQueueActions - Whether to show queue-related actions
 * @param onRemoveFromQueue - Callback for removing track from queue
 * @param playlists - Available playlists for "Add to Playlist" functionality
 * @param itemActions - Optional render prop for custom per-track action buttons
 * 
 * @example
 * ```tsx
 * <TrackListItem
 *   track={trackData}
 *   userTrack={userTrackData}
 *   index={0}
 *   playlists={userPlaylists}
 * />
 * ```
 */
export const TrackListItem = memo(function TrackListItem({ track, userTrack, index, playlistContext, isDeleted, showQueueActions, onRemoveFromQueue, showPlaylistActions, onRemoveFromPlaylist, playlists, showDuration = true, itemActions }: TrackListItemProps) {
	const [isHovered, setIsHovered] = useState(false)
	const [isActionsSheetOpen, setIsActionsSheetOpen] = useState(false)
	const [isPlaylistSheetOpen, setIsPlaylistSheetOpen] = useState(false)
	const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false)
	const isMobile = useIsMobile()
	const { currentTrack, currentIndex, isPlayerVisible, playTrack, playNextTrack, addToUpNext, addToQueue } = useAudioPlayer()

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

	const hasAudioFiles = track.audioFiles && track.audioFiles.length > 0 && !isDeleted

	// Radix dropdowns portal outside the row. When the menu closes, the browser can
	// synthesize a click on the element underneath (this row's onClick=play). stopPropagation
	// on the actions container does not help — portaled content is not a DOM child of the row.
	// preventDefault on pointerdown stops that ghost click from being created.
	// See: https://github.com/radix-ui/primitives/issues/1242
	//      https://github.com/radix-ui/primitives/issues/2267
	//      https://github.com/radix-ui/primitives/issues/3099
	//      https://react.dev/reference/react-dom/createPortal#handling-events-from-a-portal
	const handleMenuPointerDown = useCallback((event: PointerEvent) => {
		const target = event.target
		if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) {
			return
		}
		event.preventDefault()
	}, [])

	const handlePlayTrack = useCallback(() => {
		if (!track.audioFiles || track.audioFiles.length === 0 || isDeleted) {
			return
		}
		const context = playlistContext || { type: 'library' as const }
		playTrack(track, context, index)
	}, [track, playlistContext, index, playTrack, isDeleted])

	const handlePlayNext = useCallback(() => {
		if (!hasAudioFiles) return

		playNextTrack(track)
		toast({
			title: 'Success',
			description: `"${track.title}" will play next`,
			variant: 'success',
		})
		setIsActionsSheetOpen(false)
	}, [hasAudioFiles, playNextTrack, track])

	const handleAddToUpNext = useCallback(() => {
		if (!hasAudioFiles) return

		addToUpNext(track)
		toast({
			title: 'Success',
			description: `"${track.title}" added to up next`,
			variant: 'success',
		})
		setIsActionsSheetOpen(false)
	}, [hasAudioFiles, addToUpNext, track])

	const handleAddToQueue = useCallback(() => {
		if (!hasAudioFiles) return

		addToQueue(track)
		toast({
			title: 'Success',
			description: `"${track.title}" added to queue`,
			variant: 'success',
		})
		setIsActionsSheetOpen(false)
	}, [hasAudioFiles, addToQueue, track])

	// Check if this track is currently playing (both ID and position must match for duplicates)
	const isCurrentlyPlaying = currentTrack?.id === track.id && currentIndex === index

	return (
		<div 
			className={`group flex items-center gap-4 px-4 py-2 rounded-md hover:bg-muted/50 transition-colors h-20 ${
				isCurrentlyPlaying ? 'bg-primary/5' : ''
			} ${isDeleted ? 'opacity-60' : ''}`}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			onClick={hasAudioFiles ? handlePlayTrack : undefined}
			role="gridcell"
			aria-label={`Track ${index + 1}: ${track.title} by ${track.artist.name}${isDeleted ? ' (Deleted from YouTube)' : ''}`}
			style={hasAudioFiles ? { cursor: 'pointer' } : undefined}
		>
			{/* Track Number / Play Button */}
			<div className="w-8 flex items-center justify-center min-w-8">
				{hasAudioFiles && (isHovered || isCurrentlyPlaying) ? (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-8 p-0"
						onClick={(e) => {
							e.stopPropagation()
							handlePlayTrack()
						}}
						aria-label={isCurrentlyPlaying ? 'Pause track' : `Play ${track.title}`}
					>
						<Icon 
							name={isCurrentlyPlaying ? 'pause' : 'play'} 
							className="h-4 w-4" 
						/>
					</Button>
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
						<TrackThumbnail 
							coverImage={track.coverImage}
							thumbnailUrl={track.thumbnailUrl}
							alt={track.title}
							size="sm"
						/>
					</div>

					{/* Title and Artist */}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<div className="font-medium text-sm truncate group-hover:text-foreground transition-colors">
								{track.title}
							</div>
							{isDeleted && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex-shrink-0">
											<Icon name="question-mark-circled" className="h-4 w-4 text-muted-foreground" />
										</div>
									</TooltipTrigger>
									<TooltipContent>
										<p>This video has been deleted from YouTube</p>
									</TooltipContent>
								</Tooltip>
							)}
							{track.service?.displayName === 'YouTube' && !isDeleted && (
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
							{track.artist.name}
							{isDeleted && (
								<span className="ml-2 text-muted-foreground/70">• Deleted from YouTube</span>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Duration */}
			{showDuration && (
				<div className="hidden md:flex text-xs text-muted-foreground w-12 text-center">
					{formatDuration(track.duration)}
				</div>
			)}

			{/* Actions */}
			<div className="flex items-center gap-1 w-8" onClick={(e) => e.stopPropagation()}>
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
						<DropdownMenuContent align="end" onPointerDown={handleMenuPointerDown}>
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
											<TrackThumbnail 
												coverImage={track.coverImage}
												thumbnailUrl={track.thumbnailUrl}
												alt={track.title}
												size="md"
											/>
												<div className="min-w-0 flex-1">
													<div className="font-medium text-sm truncate" title={track.title}>
														{track.title}
													</div>
													<div className="text-xs text-muted-foreground truncate" title={track.artist.name}>
														{track.artist.name}
													</div>
												</div>
											</div>
										</DialogTitle>
									</DialogHeader>
									<div className="mt-6 space-y-4">
										<div className="space-y-2">
											<div className="text-sm font-medium">Track Information</div>
											<div className="text-sm text-muted-foreground space-y-1">
												<div>Artist: {track.artist.name}</div>
												<div>Duration: {formatDuration(track.duration)}</div>
												<div>Added: {new Date(userTrack.createdAt).toLocaleDateString()}</div>
												{track.service?.displayName && (
													<div>Source: {track.service.displayName}</div>
												)}
											</div>
										</div>
										{track.serviceUrl && (
											<div className="flex gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => track.serviceUrl && window.open(track.serviceUrl, '_blank')}
													className="flex-1"
												>
													<Icon name="link-2" className="h-4 w-4 mr-2" />
													Open on YouTube
												</Button>
											</div>
										)}
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
							{playlists != null && (
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<Icon name="plus" className="h-4 w-4 mr-2" />
										Add to Playlist
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent onPointerDown={handleMenuPointerDown}>
										<AddToPlaylistMenu 
											trackId={track.id} 
											trackTitle={track.title}
											playlists={playlists}
										/>
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							)}
							{hasAudioFiles && (
								<>
									<DropdownMenuItem onClick={handlePlayNext}>
										<Icon name="arrow-right" className="h-4 w-4 mr-2" />
										Play next
									</DropdownMenuItem>
									<DropdownMenuItem onClick={handleAddToUpNext}>
										<Icon name="list-bullet" className="h-4 w-4 mr-2" />
										Add to up next
									</DropdownMenuItem>
									<DropdownMenuItem onClick={handleAddToQueue}>
										<Icon name="plus" className="h-4 w-4 mr-2" />
										Add to queue
									</DropdownMenuItem>
								</>
							)}
							{showQueueActions && (
								<DropdownMenuItem onClick={handleRemoveFromQueue}>
									<Icon name="trash" className="h-4 w-4 mr-2" />
									Remove from Queue
								</DropdownMenuItem>
							)}
							{showPlaylistActions && onRemoveFromPlaylist && (
								<DropdownMenuItem onClick={() => onRemoveFromPlaylist(track.id)}>
									<Icon name="trash" className="h-4 w-4 mr-2" />
									Remove from Playlist
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			
			{/* Custom actions from render prop */}
			<div onClick={(e) => e.stopPropagation()}>
				{itemActions?.({
					trackId: track.id,
					isInLibrary: !!track.isInUserLibrary,
					isDeleted: !!isDeleted,
				})}
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
										<TrackThumbnail 
											coverImage={track.coverImage}
											alt={track.title}
											size="md"
										/>
										<div className="min-w-0 flex-1">
											<div className="font-medium text-sm truncate" title={track.title}>
												{track.title}
											</div>
											<div className="text-xs text-muted-foreground truncate" title={track.artist.name}>
												{track.artist.name}
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
								{playlists != null && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={handleOpenPlaylistSheet}
									>
										<Icon name="plus" className="h-5 w-5 mr-3" />
										Add to Playlist
									</Button>
								)}
								{hasAudioFiles && (
									<>
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											onClick={handlePlayNext}
										>
											<Icon name="arrow-right" className="h-5 w-5 mr-3" />
											Play next
										</Button>
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											onClick={handleAddToUpNext}
										>
											<Icon name="list-bullet" className="h-5 w-5 mr-3" />
											Add to up next
										</Button>
										<Button
											variant="ghost"
											className="w-full justify-start h-12 text-base"
											onClick={handleAddToQueue}
										>
											<Icon name="plus" className="h-5 w-5 mr-3" />
											Add to queue
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
								{showPlaylistActions && onRemoveFromPlaylist && (
									<Button
										variant="ghost"
										className="w-full justify-start h-12 text-base"
										onClick={() => {
											onRemoveFromPlaylist(track.id)
											setIsActionsSheetOpen(false)
										}}
									>
										<Icon name="trash" className="h-5 w-5 mr-3" />
										Remove from Playlist
									</Button>
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
										<TrackThumbnail 
											coverImage={track.coverImage}
											alt={track.title}
											size="md"
										/>
										<div className="min-w-0 flex-1">
											<div className="font-medium text-sm truncate" title={track.title}>
												{track.title}
											</div>
											<div className="text-xs text-muted-foreground truncate" title={track.artist.name}>
												{track.artist.name}
											</div>
										</div>
									</div>
								</SheetTitle>
							</SheetHeader>
							<div className="mt-6 space-y-4">
								<div className="space-y-2">
									<div className="text-sm font-medium">Track Information</div>
									<div className="text-sm text-muted-foreground space-y-1">
										<div>Artist: {track.artist.name}</div>
										<div>Duration: {formatDuration(track.duration)}</div>
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
								</div>
							</div>
						</SheetContent>
					</Sheet>

				</>
			)}
		</div>
	)
})
