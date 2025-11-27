import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#app/components/ui/sheet.tsx'
import { formatDuration } from '#app/utils/format-duration.ts'
import { cn } from '#app/utils/misc.tsx'
import { useIsMobile } from '#app/utils/use-mobile.ts'
import { EditableText } from './editable-text'
import { PlaylistCover } from './playlist-cover'

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
}

interface PlaylistHeroProps {
	id: string
	title: string
	description: string | null
	tracks: Track[]
	createdAt: string
	updatedAt: string
	onTitleUpdate: (newTitle: string) => void
	onDescriptionUpdate: (newDescription: string) => void
	onAddAllToQueue: () => void
	onDelete: () => void
	isUpdating?: boolean
	className?: string
}

// Generate a gradient color based on playlist title
function getGradientFromTitle(title: string): string {
	const colors: string[] = [
		'from-blue-500 to-purple-600',
		'from-green-500 to-blue-600', 
		'from-purple-500 to-pink-600',
		'from-orange-500 to-red-600',
		'from-teal-500 to-blue-600',
		'from-pink-500 to-purple-600',
		'from-indigo-500 to-purple-600',
		'from-emerald-500 to-teal-600'
	]
	
	const hash = title.split('').reduce((a, b) => {
		a = ((a << 5) - a) + b.charCodeAt(0)
		return a & a
	}, 0)
	
	const index = Math.abs(hash) % colors.length
	return colors[index]!
}

export function PlaylistHero({
	id,
	title,
	description,
	tracks,
	createdAt,
	updatedAt,
	onTitleUpdate,
	onDescriptionUpdate,
	onAddAllToQueue,
	onDelete,
	isUpdating = false,
	className
}: PlaylistHeroProps) {
	const [isActionsSheetOpen, setIsActionsSheetOpen] = useState(false)
	const isMobile = useIsMobile()
	const totalDuration = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
	const gradientClass = getGradientFromTitle(title)
	
	
	return (
		<>
			<div className={cn(
				'relative rounded-lg overflow-hidden',
				className
			)}>
				{/* Background Gradient */}
				<div className={cn(
					'absolute inset-0 bg-gradient-to-br',
					gradientClass
				)} />
				<div className="absolute inset-0 bg-black/30" />
				
				{/* Content */}
				<div className="relative p-4 md:p-6 lg:p-8">
					<div className="flex flex-col md:flex-row gap-4 md:gap-6">
						{/* Cover */}
						<div className="flex-shrink-0 mx-auto md:mx-0">
							<PlaylistCover tracks={tracks} size={isMobile ? "md" : "lg"} />
						</div>
						
						{/* Info */}
						<div className="flex-1 min-w-0 space-y-3 md:space-y-4 text-center md:text-left">
							{/* Title */}
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<EditableText
										value={title}
										onSave={onTitleUpdate}
										placeholder="Untitled Playlist"
										className="text-2xl md:text-3xl lg:text-4xl font-bold text-white"
										maxLength={100}
										disabled={isUpdating}
									/>
									{isUpdating && (
										<Icon name="update" className="h-4 w-4 md:h-5 md:w-5 animate-spin text-white/60" />
									)}
								</div>
								<div className="flex items-center gap-2">
									<EditableText
										value={description || ''}
										onSave={onDescriptionUpdate}
										placeholder="Add a description..."
										className="text-white/80 text-base md:text-lg"
										multiline
										maxLength={500}
										disabled={isUpdating}
									/>
								</div>
							</div>
							
							{/* Stats */}
							<div className="flex flex-wrap items-center justify-center md:justify-start gap-3 md:gap-4 text-white/80 text-xs md:text-sm">
								<div className="flex items-center gap-1">
									<Icon name="file-text" className="h-3 w-3 md:h-4 md:w-4" />
									<span>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
								</div>
								{totalDuration > 0 && (
									<div className="flex items-center gap-1">
										<Icon name="clock" className="h-3 w-3 md:h-4 md:w-4" />
										<span>{formatDuration(totalDuration)}</span>
									</div>
								)}
								<div className="flex items-center gap-1">
									<Icon name="calendar" className="h-3 w-3 md:h-4 md:w-4" />
									<span>Created {new Date(createdAt).toLocaleDateString()}</span>
								</div>
							</div>
							
							{/* Actions */}
							<div className="flex flex-wrap justify-center md:justify-start gap-2 md:gap-3">
								<Button
									variant="secondary"
									size={isMobile ? "default" : "lg"}
									onClick={onAddAllToQueue}
									className="bg-white/20 hover:bg-white/30 text-white border-white/30"
								>
									<Icon name="plus" className="h-4 w-4 md:h-5 md:w-5 mr-2" />
									Add to Queue
								</Button>
								<Button
									variant="destructive"
									size={isMobile ? "default" : "lg"}
									onClick={onDelete}
									className="bg-red-500/20 hover:bg-red-500/30 text-white border-red-500/30"
								>
									<Icon name="trash" className="h-4 w-4 md:h-5 md:w-5 mr-2" />
									Delete
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Mobile Actions Sheet */}
			{isMobile && (
				<Sheet open={isActionsSheetOpen} onOpenChange={setIsActionsSheetOpen}>
					<SheetContent side="bottom" className="h-[50vh]">
						<SheetHeader>
							<SheetTitle>Playlist Actions</SheetTitle>
						</SheetHeader>
						<div className="mt-6 space-y-3">
							<Button
								variant="ghost"
								className="w-full justify-start h-12 text-base"
								onClick={() => {
									onAddAllToQueue()
									setIsActionsSheetOpen(false)
								}}
							>
								<Icon name="plus" className="h-5 w-5 mr-3" />
								Add All to Queue
							</Button>
							<Button
								variant="ghost"
								className="w-full justify-start h-12 text-base text-destructive hover:bg-destructive/10"
								onClick={() => {
									onDelete()
									setIsActionsSheetOpen(false)
								}}
							>
								<Icon name="trash" className="h-5 w-5 mr-3" />
								Delete Playlist
							</Button>
						</div>
					</SheetContent>
				</Sheet>
			)}
		</>
	)
}
