import { useState, useEffect } from 'react'
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
} from '@dnd-kit/sortable'
import {
	useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Checkbox } from '#app/components/ui/checkbox.tsx'
import { cn } from '#app/utils/misc.tsx'
import { TrackListItem } from './track-list-item'

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
	audioFile?: {
		id: string
		objectKey: string | null
		fileName: string | null
		fileSize: number | null
		mimeType: string | null
		status: string
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
			<div
				{...attributes}
				{...listeners}
				className={cn(
					"absolute top-1/2 -translate-y-1/2 w-8 h-12 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-80 group-hover:opacity-100 transition-all duration-200 ease-out hover:bg-muted/50 rounded z-30",
					showSelection ? "left-8" : "left-2"
				)}
			>
				<Icon name="drag-handle-dots-2" className="h-4 w-4 text-foreground/60 transition-colors duration-200" />
			</div>

			{/* Track Item */}
			<div className={cn("pl-10", showSelection && "pl-16")}>
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
		<div className={cn('space-y-4', className)}>
			{/* Bulk Actions Bar */}
			{showSelection && (
				<div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border/50 animate-in slide-in-from-top-2 duration-300">
					<div className="flex items-center gap-4">
						<Checkbox
							checked={selectedTracks.size === items.length}
							onCheckedChange={handleSelectAll}
						/>
						<span className="text-sm font-medium">
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
						>
							<Icon name="plus" className="h-4 w-4 mr-2" />
							Add to Queue
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClick={handleBulkRemove}
							disabled={selectedTracks.size === 0 || isReordering || isRemoving}
							className="transition-all duration-200 ease-out hover:scale-105"
						>
							<Icon name="trash" className="h-4 w-4 mr-2" />
							Remove Selected
						</Button>
					</div>
				</div>
			)}

			{/* Selection Toggle */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={toggleSelectionMode}
						disabled={isReordering || isRemoving}
					>
						<Icon name="check" className="h-4 w-4 mr-2" />
						{showSelection ? 'Cancel Selection' : 'Select Tracks'}
					</Button>
					{(isReordering || isRemoving) && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Icon name="update" className="h-3 w-3 animate-spin" />
							<span>{isReordering ? 'Reordering...' : 'Removing...'}</span>
						</div>
					)}
				</div>
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<div className="space-y-1">
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
