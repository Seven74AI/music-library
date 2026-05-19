import { useState, useRef, useEffect } from 'react'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '#app/components/ui/dialog'
import { Icon } from '#app/components/ui/icon'
import { Label } from '#app/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#app/components/ui/radio-group'

interface PendingMatch {
	deletedVideo: {
		position: number
		itemId: string | undefined
		title: string | undefined
	}
	candidateTracks: Array<{
		id: string
		title: string
		artist: string
		externalId: string | null
		position: number
		isDeleted: boolean
	}>
}

interface DeletedVideoMatchDialogProps {
	pendingMatches: PendingMatch[]
	playlistId: string
	onClose: () => void
	onSyncButtonStateChange?: (disabled: boolean) => void
}

const ITEMS_PER_PAGE = 5

export function DeletedVideoMatchDialog({
	pendingMatches,
	playlistId,
	onClose,
	onSyncButtonStateChange,
}: DeletedVideoMatchDialogProps) {
	const [currentPage, setCurrentPage] = useState(1)
	const [selections, setSelections] = useState<Record<number, { action: 'match' | 'new' | 'skip'; trackId?: string }>>({})
	const hasNotifiedRef = useRef(false)

	const totalPages = Math.ceil(pendingMatches.length / ITEMS_PER_PAGE)
	const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
	const endIndex = startIndex + ITEMS_PER_PAGE
	const currentMatches = pendingMatches.slice(startIndex, endIndex)

	const allSelected = pendingMatches.every((_, index) => {
		return selections[index] !== undefined
	})

	const handleSelectionChange = (matchIndex: number, action: 'match' | 'new' | 'skip', trackId?: string) => {
		setSelections(prev => ({
			...prev,
			[matchIndex]: { action, trackId }
		}))
	}

	// Notify parent about sync button state when dialog opens
	// Use useEffect to avoid side effects during render
	useEffect(() => {
		if (!hasNotifiedRef.current && onSyncButtonStateChange) {
			onSyncButtonStateChange(true)
			hasNotifiedRef.current = true
		}

		return () => {
			// Re-enable sync button when component unmounts or dialog closes
			if (onSyncButtonStateChange && hasNotifiedRef.current) {
				onSyncButtonStateChange(false)
				hasNotifiedRef.current = false
			}
		}
	}, [onSyncButtonStateChange])

	const handleClose = () => {
		// Re-enable sync button when dialog closes
		if (onSyncButtonStateChange) {
			onSyncButtonStateChange(false)
		}
		hasNotifiedRef.current = false
		onClose()
	}

	return (
		<Dialog open={true} onOpenChange={handleClose}>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Match Deleted Videos</DialogTitle>
					<DialogDescription>
						Some videos in this playlist have been deleted from YouTube. Please choose how to handle each one.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{currentMatches.map((match, localIndex) => {
						const matchIndex = startIndex + localIndex
						const selection = selections[matchIndex]

						return (
							<div key={matchIndex} className="border rounded-lg p-4 space-y-3">
								<div className="flex items-center gap-2">
									<span className="font-semibold">Position {match.deletedVideo.position}</span>
									{selection && (
										<Icon name="check" className="h-4 w-4 text-green-600 dark:text-green-400" />
									)}
								</div>

								{match.deletedVideo.title && (
									<p className="text-sm text-muted-foreground">
										{match.deletedVideo.title}
									</p>
								)}

								{match.candidateTracks.length > 0 ? (
									<div className="space-y-2">
										<Label className="text-sm font-medium">Candidate Tracks:</Label>
										<RadioGroup
											value={selection?.action === 'match' ? `match-${selection.trackId}` : selection?.action || ''}
											onValueChange={(value: string) => {
												if (value.startsWith('match-')) {
													const trackId = value.replace('match-', '')
													handleSelectionChange(matchIndex, 'match', trackId)
												} else if (value === 'new' || value === 'skip') {
													handleSelectionChange(matchIndex, value)
												}
											}}
										>
											{match.candidateTracks.map((candidate) => (
												<div key={candidate.id} className="flex items-center space-x-2">
													<RadioGroupItem value={`match-${candidate.id}`} id={`match-${matchIndex}-${candidate.id}`} />
													<Label htmlFor={`match-${matchIndex}-${candidate.id}`} className="flex-1 cursor-pointer">
														<span className="font-medium">{candidate.title}</span>
														{candidate.artist && (
															<span className="text-sm text-muted-foreground ml-2">by {candidate.artist}</span>
														)}
														<span className="text-xs text-muted-foreground ml-2">(Position {candidate.position})</span>
													</Label>
												</div>
											))}
											<div className="flex items-center space-x-2">
												<RadioGroupItem value="new" id={`new-${matchIndex}`} />
												<Label htmlFor={`new-${matchIndex}`} className="cursor-pointer">
													Create New Track
												</Label>
											</div>
											<div className="flex items-center space-x-2">
												<RadioGroupItem value="skip" id={`skip-${matchIndex}`} />
												<Label htmlFor={`skip-${matchIndex}`} className="cursor-pointer">
													Skip
												</Label>
											</div>
										</RadioGroup>
									</div>
								) : (
									<div className="space-y-2">
										<p className="text-sm text-muted-foreground">
											No existing tracks found to match. Create a new track or skip.
										</p>
										<RadioGroup
											value={selection?.action || ''}
											onValueChange={(value: string) => {
												if (value === 'new' || value === 'skip') {
													handleSelectionChange(matchIndex, value)
												}
											}}
										>
											<div className="flex items-center space-x-2">
												<RadioGroupItem value="new" id={`new-${matchIndex}`} />
												<Label htmlFor={`new-${matchIndex}`} className="cursor-pointer">
													Create New Track
												</Label>
											</div>
											<div className="flex items-center space-x-2">
												<RadioGroupItem value="skip" id={`skip-${matchIndex}`} />
												<Label htmlFor={`skip-${matchIndex}`} className="cursor-pointer">
													Skip
												</Label>
											</div>
										</RadioGroup>
									</div>
								)}
							</div>
						)
					})}
				</div>

				{totalPages > 1 && (
					<div className="flex items-center justify-between py-2 border-t">
						<Button
							type="button"
							variant="outline"
							onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
							disabled={currentPage === 1}
						>
							<Icon name="arrow-left" className="h-4 w-4 mr-2" />
							Previous
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {currentPage} of {totalPages} ({pendingMatches.length} total)
						</span>
						<Button
							type="button"
							variant="outline"
							onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
							disabled={currentPage === totalPages}
						>
							Next
							<Icon name="arrow-right" className="h-4 w-4 ml-2" />
						</Button>
					</div>
				)}

				<div className="flex items-center justify-between py-2">
					<span className="text-sm text-muted-foreground">
						{Object.keys(selections).length} of {pendingMatches.length} matches confirmed
					</span>
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={handleClose}>
						Cancel
					</Button>
					<Form method="post" action={`/music/services/youtube/playlist/${playlistId}`}>
						<input 
							type="hidden" 
							name="intent" 
							value="confirm-deleted-match" 
						/>
						<input 
							type="hidden" 
							name="matches" 
							value={JSON.stringify(
								pendingMatches.map((match, index) => {
									const selection = selections[index]
									if (!selection) {
										return {
											deletedItemId: match.deletedVideo.itemId,
											selectedTrackId: null,
											position: match.deletedVideo.position,
											action: 'skip' as const
										}
									}

									return {
										deletedItemId: match.deletedVideo.itemId,
										selectedTrackId: selection.action === 'match' ? selection.trackId || null : null,
										position: match.deletedVideo.position,
										action: selection.action
									}
								})
							)} 
						/>
						<Button type="submit" disabled={!allSelected}>
							Confirm All Matches
						</Button>
					</Form>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

