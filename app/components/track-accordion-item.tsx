import { useState } from 'react'
import { NavLink } from 'react-router'
import { ActionButton } from '#app/components/ui/action-button'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip'
import { downloadTrack } from '#app/utils/download.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { formatFileSize } from '#app/utils/format-file-size.ts'

interface TrackAccordionItemProps {
	track: {
		id: string
		title: string
		artist: string
		duration: number | null
		thumbnailUrl: string | null
		serviceUrl: string | null
		audioFile?: {
			objectKey: string | null
			fileSize: number | null
		} | null
		service?: {
			displayName: string
			logoUrl: string | null
		} | null
	}
	userTrack: {
		createdAt: string | Date
	}
}

// Custom accordion item component with ARIA best practices
export function TrackAccordionItem({ track, userTrack }: TrackAccordionItemProps) {
	const [isOpen, setIsOpen] = useState(false)
	const accordionId = `accordion-${track.id}`
	const contentId = `content-${track.id}`

	const toggleAccordion = () => {
		setIsOpen(prev => !prev)
	}

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			toggleAccordion()
		}
	}

	const handleClick = (event: React.MouseEvent) => {
		event.stopPropagation()
	}

	const handleDownload = () => {
		void downloadTrack(track.id, `${track.title}.mp3`)
	}



	return (
		<div className="border rounded-lg">
			{/* Header area with selectable text and clickable toggle */}
			<div 
				className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
				onClick={toggleAccordion}
				role="button"
				tabIndex={0}
				aria-expanded={isOpen}
				aria-controls={contentId}
				id={accordionId}
				onKeyDown={handleKeyDown}
			>
				{/* Track Thumbnail */}
				<div className="flex-shrink-0">
					{track.thumbnailUrl ? (
						<img 
							src={track.thumbnailUrl} 
							alt={track.title}
							className="h-10 w-10 rounded object-cover"
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

				{/* Track Info - Selectable text */}
				<div className="min-w-0 flex-1 text-left select-text">
					<div className="font-medium text-sm truncate" title={track.title}>
						{track.title}
					</div>
					<div className="text-xs text-muted-foreground truncate" title={track.artist}>
						{track.artist}
					</div>
				</div>

				{/* Duration - Selectable text */}
				<div className="text-xs text-muted-foreground select-text">
					{formatDuration(track.duration || 0)}
				</div>

				{/* Actions - Desktop visible, Mobile hidden */}
				<div className="hidden md:flex items-center gap-1" onClick={handleClick}>
					<NavLink
						to={track.id}
						className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8"
						title="View track details"
					>
						<Icon name="eye-open" className="h-4 w-4" />
					</NavLink>
					{track.serviceUrl && (
						<ActionButton
							icon="link-2"
							title="Open on YouTube"
							href={track.serviceUrl}
							target="_blank"
							rel="noopener noreferrer"
						/>
					)}
					{track.audioFile?.objectKey ? (
						<ActionButton
							icon="download"
							title="Download audio file"
							onClick={handleDownload}
						/>
					) : (
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-8 w-8 text-muted-foreground">
									<Icon name="clock" className="h-4 w-4" />
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p>Audio is currently being processed and will be available for download soon</p>
							</TooltipContent>
						</Tooltip>
					)}
				</div>

				{/* Mobile Actions Drawer */}
				<div className="md:hidden" onClick={handleClick}>
					<Sheet>
						<SheetTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-8 w-8 p-0"
								title="More actions"
							>
								<Icon name="dots-horizontal" className="h-4 w-4" />
							</Button>
						</SheetTrigger>
						<SheetContent side="bottom" className="h-auto">
							<SheetHeader>
								<SheetTitle className="text-left">
									<div className="flex items-center gap-3">
										{track.thumbnailUrl ? (
											<img 
												src={track.thumbnailUrl} 
												alt={track.title}
												className="h-12 w-12 rounded object-cover"
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
							<div className="mt-6 space-y-2">
								<NavLink
									to={track.id}
									className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
								>
									<Icon name="eye-open" className="h-5 w-5" />
									<span>View track details</span>
								</NavLink>
								{track.serviceUrl && (
									<a
										href={track.serviceUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
									>
										<Icon name="link-2" className="h-5 w-5" />
										<span>Open on YouTube</span>
									</a>
								)}
								{track.audioFile?.objectKey ? (
									<button
										onClick={handleDownload}
										className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors w-full text-left"
									>
										<Icon name="download" className="h-5 w-5" />
										<span>Download audio file</span>
									</button>
								) : (
									<div className="flex items-center gap-3 p-3 rounded-lg text-muted-foreground">
										<Icon name="clock" className="h-5 w-5" />
										<span>Audio is being processed</span>
									</div>
								)}
							</div>
						</SheetContent>
					</Sheet>
				</div>

				{/* Toggle indicator */}
				<div className="ml-2">
					<Icon 
						name="chevron-down" 
						className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
					/>
				</div>
			</div>

			{/* Collapsible content */}
			<div
				id={contentId}
				aria-labelledby={accordionId}
				className={`overflow-hidden transition-all duration-200 ${
					isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
				}`}
			>
				<div className="px-6 pt-4 pb-4">
					<div className="grid grid-cols-2 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground text-xs">Source:</span>
							<div className="font-medium flex items-center gap-2">
								{track.service?.logoUrl ? (
									<img src={track.service.logoUrl} alt={track.service.displayName} className="w-4 h-4" />
								) : (
									<Icon name="link-2" className="w-4 h-4 text-muted-foreground" />
								)}
								{track.service?.displayName || 'Unknown'}
							</div>
						</div>
						<div>
							<span className="text-muted-foreground text-xs">Added:</span>
							<div className="font-medium">{new Date(userTrack.createdAt).toLocaleDateString()}</div>
						</div>
						<div>
							<span className="text-muted-foreground text-xs">File Size:</span>
							<div className="font-medium">
								{formatFileSize(track.audioFile?.fileSize)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
