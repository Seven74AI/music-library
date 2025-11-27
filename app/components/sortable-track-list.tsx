import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core'
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
	useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, useEffect } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Checkbox } from '#app/components/ui/checkbox.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import { TrackListItem } from './track-list-item'

function announceToScreenReader(message: string) {
	const announcementEl = document.getElementById('drag-announcements')
	if (announcementEl) {
		announcementEl.textContent = message
		// Clear after announcement to allow repeated announcements
		setTimeout(() => {
			announcementEl.textContent = ''
		}, 1000)
	}
}

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
	serviceUrl: string | null
	createdAt: string
	service?: {
		displayName: string
		logoUrl: string | null
	} | null
}

interface PlaylistTrack {
	id: string
	position: number
	track: Track
}

interface SortableTrackItemProps {
	track: PlaylistTrack
	index: number
	playlists: Array<{ id: string; title: string; description: string | null; _count: { tracks: number } }>
	onRemove: (trackId: string) => void
	isSelected: boolean
	onSelectionChange: (trackId: string, selected: boolean) => void
	showSelection: boolean
	playlistId: string
}

function SortableTrackItem({ track, index, playlists, onRemove, isSelected, onSelectionChange, showSelection, playlistId }: SortableTrackItemProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: track.id })

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				'relative group transition-all duration-200 ease-out',
				isDragging && 'opacity-50 z-50 scale-105 shadow-lg',
				isSelected && 'bg-primary/10 ring-1 ring-primary/20'
			)}
			role="listitem"
			aria-selected={isSelected}
			aria-grabbed={isDragging}
			aria-label={`Track ${index + 1}: ${track.track.title} by ${track.track.artist}`}
		>
			{/* Selection Checkbox */}
			{showSelection && (
				<div className="absolute left-2 top-1/2 -translate-y-1/2 z-20">
					<Checkbox
						checked={isSelected}
						onCheckedChange={(checked) => onSelectionChange(track.id, !!checked)}
					/>
				</div>
			)}

			{/* Drag Handle */}
			<Button
				{...attributes}
				{...listeners}
				variant="ghost"
				size="sm"
				className={cn(
					"absolute top-1/2 -translate-y-1/2 w-8 h-12 p-0 cursor-grab active:cursor-grabbing opacity-80 group-hover:opacity-100 transition-all duration-200 ease-out hover:bg-muted/50 rounded z-30",
					showSelection ? "left-8" : "left-2"
				)}
				aria-pressed={isDragging}
				aria-label={`Drag handle for track ${index + 1}: ${track.track.title} by ${track.track.artist}. Press Space or Enter to activate drag mode, then use arrow keys to reorder.`}
				aria-describedby={`track-${track.id}-description`}
				onKeyDown={(e) => {
					if (e.key === 'Escape' && isDragging) {
						e.preventDefault()
						// Cancel drag operation
						announceToScreenReader('Drag operation cancelled')
					}
				}}
			>
				<Icon name="drag-handle-dots-2" className="h-4 w-4 text-foreground/60 transition-colors duration-200" aria-hidden="true" />
			</Button>

			{/* Track Item */}
			<div className={cn("pl-10", showSelection && "pl-16")} id={`track-${track.id}-description`}>
				<TrackListItem
					track={track.track}
					userTrack={{ createdAt: track.track.createdAt }}
					index={index}
					playlistContext={{ type: 'playlist', playlistId: playlistId }}
					playlists={playlists}
					showPlaylistActions={true}
					onRemoveFromPlaylist={() => onRemove(track.id)}
				/>
			</div>

		</div>
	)
}

interface SortableTrackListProps {
	tracks: PlaylistTrack[]
	playlists: Array<{ id: string; title: string; description: string | null; _count: { tracks: number } }>
	onReorder: (newOrder: Array<{ id: string; position: number }>) => void
	onRemoveTrack: (trackId: string) => void
	onBulkRemove: (trackIds: string[]) => void
	onBulkAddToQueue: (trackIds: string[]) => void
	isReordering?: boolean
	isRemoving?: boolean
	className?: string
	playlistId: string
}

export function SortableTrackList({ 
	tracks, 
	playlists, 
	onReorder, 
	onRemoveTrack,
	onBulkRemove,
	onBulkAddToQueue,
	isReordering = false,
	isRemoving = false,
	className,
	playlistId
}: SortableTrackListProps) {
	const [items, setItems] = useState(tracks)
	const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())
	const [showSelection, setShowSelection] = useState(false)
	
	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	)

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event

		if (over && active.id !== over.id) {
			const oldIndex = items.findIndex(item => item.id === active.id)
			const newIndex = items.findIndex(item => item.id === over.id)

			const newItems = arrayMove(items, oldIndex, newIndex)
			setItems(newItems)

			// Update positions and call onReorder
			const newOrder = newItems.map((item, index) => ({
				id: item.id,
				position: index + 1
			}))
			onReorder(newOrder)

			// Announce the change to screen readers
			const movedTrack = items.find(item => item.id === active.id)
			if (movedTrack) {
				const announcement = `Track "${movedTrack.track.title}" moved from position ${oldIndex + 1} to position ${newIndex + 1}`
				announceToScreenReader(announcement)
			}
		}
	}


	function handleDragStart(event: any) {
		const activeId = event.active.id
		const activeTrack = items.find(item => item.id === activeId)
		if (activeTrack) {
			const announcement = `Started dragging track "${activeTrack.track.title}". Use arrow keys to move it to a new position, or press Escape to cancel.`
			announceToScreenReader(announcement)
		}
	}

	function handleSelectionChange(trackId: string, selected: boolean) {
		setSelectedTracks(prev => {
			const newSet = new Set(prev)
			if (selected) {
				newSet.add(trackId)
			} else {
				newSet.delete(trackId)
			}
			return newSet
		})
	}

	function handleSelectAll() {
		if (selectedTracks.size === items.length) {
			setSelectedTracks(new Set())
		} else {
			setSelectedTracks(new Set(items.map(item => item.id)))
		}
	}

	function handleBulkRemove() {
		onBulkRemove(Array.from(selectedTracks))
		setSelectedTracks(new Set())
		setShowSelection(false)
	}

	function handleBulkAddToQueue() {
		onBulkAddToQueue(Array.from(selectedTracks))
		setSelectedTracks(new Set())
		setShowSelection(false)
	}

	function toggleSelectionMode() {
		setShowSelection(!showSelection)
		if (showSelection) {
			setSelectedTracks(new Set())
		}
	}

	// Update local state when tracks prop changes
	useEffect(() => {
		setItems(tracks)
	}, [tracks])

	return (
		<div className={cn('space-y-4', className)} role="region" aria-label="Playlist tracks">
			{/* Screen reader announcements for drag and drop */}
			<div 
				id="drag-announcements" 
				aria-live="polite" 
				aria-atomic="true" 
				className="sr-only"
			>
				{/* This will be populated by JavaScript for drag announcements */}
			</div>
			{/* Bulk Actions Bar - Sticky */}
			{showSelection && (
				<div 
					className="sticky top-0 z-40 flex items-center justify-between p-4 bg-background/95 backdrop-blur-sm border-b border-border/50 shadow-sm animate-in slide-in-from-top-2 duration-300"
					role="toolbar"
					aria-label="Bulk actions for selected tracks"
				>
					<div className="flex items-center gap-4">
						<Checkbox
							checked={selectedTracks.size === items.length}
							onCheckedChange={handleSelectAll}
							aria-label={`Select all ${items.length} tracks`}
						/>
						<span className="text-sm font-medium" aria-live="polite" aria-atomic="true">
							{selectedTracks.size} track{selectedTracks.size !== 1 ? 's' : ''} selected
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleBulkAddToQueue}
							disabled={selectedTracks.size === 0 || isReordering || isRemoving}
							className="transition-all duration-200 ease-out hover:scale-105"
							aria-label={`Add ${selectedTracks.size} selected tracks to queue`}
						>
							<Icon name="plus" className="h-4 w-4 mr-2" aria-hidden="true" />
							Add to Queue
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClick={handleBulkRemove}
							disabled={selectedTracks.size === 0 || isReordering || isRemoving}
							className="transition-all duration-200 ease-out hover:scale-105"
							aria-label={`Remove ${selectedTracks.size} selected tracks from playlist`}
						>
							<Icon name="trash" className="h-4 w-4 mr-2" aria-hidden="true" />
							Remove Selected
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={toggleSelectionMode}
							disabled={isReordering || isRemoving}
							className="transition-all duration-200 ease-out hover:scale-105"
							aria-label="Cancel track selection"
						>
							<Icon name="x-mark" className="h-4 w-4 mr-2" aria-hidden="true" />
							Cancel
						</Button>
					</div>
				</div>
			)}

			{/* Selection Toggle */}
			{!showSelection && (
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={toggleSelectionMode}
							disabled={isReordering || isRemoving}
							aria-label="Enable track selection mode"
						>
							<Icon name="check" className="h-4 w-4 mr-2" aria-hidden="true" />
							Select Tracks
						</Button>
						{(isReordering || isRemoving) && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
								<Icon name="update" className="h-3 w-3 animate-spin" aria-hidden="true" />
								<span>{isReordering ? 'Reordering tracks...' : 'Removing tracks...'}</span>
							</div>
						)}
					</div>
				</div>
			)}

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="space-y-1" role="list" aria-label={`Playlist with ${items.length} tracks`}>
					<SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
						{items.map((track, index) => (
							<SortableTrackItem
								key={track.id}
								track={track}
								index={index}
								playlists={playlists}
								onRemove={onRemoveTrack}
								isSelected={selectedTracks.has(track.id)}
								onSelectionChange={handleSelectionChange}
								showSelection={showSelection}
								playlistId={playlistId}
							/>
						))}
					</SortableContext>
				</div>
			</DndContext>
		</div>
	)
}
