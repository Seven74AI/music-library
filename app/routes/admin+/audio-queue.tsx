import { Form, useLoaderData, useNavigation, data, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '#app/components/ui/accordion'
import { Badge } from '#app/components/ui/badge'
import { Button } from '#app/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#app/components/ui/card'
import { StatusBadge } from '#app/components/ui/status-badge'
import { getQueueStats, getTracksForAdmin, enqueueTrack } from '#app/utils/audio-queue.server'
import { 
  pauseWorker, 
  resumeWorker, 
  breakLongPause,
  getWorkerStatus,
  resetTrackForRetry 
} from '#app/utils/audio-worker-control.server'
import { prisma } from '#app/utils/db.server'
import { downloadTrack } from '#app/utils/download'
import { validateAction, validateRequiredString, createValidationErrorResponse } from '#app/utils/form-validation'
import { requireUserWithRole } from '#app/utils/permissions.server'

export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserWithRole(request, 'admin')
	
	const url = new URL(request.url)
	const status = url.searchParams.get('status') || 'all'
	const page = parseInt(url.searchParams.get('page') || '1', 10)
	const limit = 50
	const offset = (page - 1) * limit

	const [stats, tracksData, workerStatus] = await Promise.all([
		getQueueStats(),
		getTracksForAdmin({ status, limit, offset }),
		getWorkerStatus(),
	])

	return data({
		stats,
		tracks: tracksData.tracks,
		totalCount: tracksData.totalCount,
		hasMore: tracksData.hasMore,
		currentPage: page,
		currentStatus: status,
		workerStatus,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	await requireUserWithRole(request, 'admin')
	
	const formData = await request.formData()
	const intent = formData.get('intent')?.toString()
	const trackId = formData.get('trackId')?.toString()

	// Validate required parameters
	const validIntents = [
		'pause-worker', 'resume-worker', 'break-long-pause', 'retry-track', 
		'archive-now', 'toggle-priority', 'delete-audio', 'requeue-track'
	] as const
	
	const intentValidation = validateAction(intent, validIntents)
	if (!intentValidation.success) {
		return createValidationErrorResponse(intentValidation.message!)
	}

	// Helper function to validate trackId for actions that require it
	const validateTrackId = (actionName: string) => {
		const trackIdValidation = validateRequiredString(trackId, 'Track ID')
		if (!trackIdValidation.success) {
			return createValidationErrorResponse(`Track ID is required for ${actionName}`)
		}
		return null
	}

	try {
		switch (intent) {
		case 'pause-worker': {
			const result = await pauseWorker()
			return data({ success: result.success, message: result.message })
		}
		
		case 'resume-worker': {
			const result = await resumeWorker()
			return data({ success: result.success, message: result.message })
		}
		
		case 'break-long-pause': {
			const result = await breakLongPause()
			return data({ success: result.success, message: result.message })
		}
		
		case 'retry-track': {
			const validationError = validateTrackId('retry-track')
			if (validationError) return validationError
			
			await resetTrackForRetry(trackId!, true) // Priority retry
			return data({ success: true, message: `Track ${trackId} queued for priority retry` })
		}
		
		case 'archive-now': {
			const validationError = validateTrackId('archive-now')
			if (validationError) return validationError
			
			await enqueueTrack(trackId!, true) // Priority archive
			return data({ success: true, message: `Track ${trackId} queued for priority archiving` })
		}
		
		case 'toggle-priority': {
			const validationError = validateTrackId('toggle-priority')
			if (validationError) return validationError
			
			// Get current track to check if it's already prioritized
			const track = await prisma.trackAudioFile.findUnique({
				where: { trackId: trackId! },
				select: { priority: true, status: true }
			})
			
			if (!track) {
				return data({ success: false, message: 'Track not found' }, { status: 404 })
			}
			
			// Toggle priority
			const newPriority = !track.priority
			await prisma.trackAudioFile.update({
				where: { trackId: trackId! },
				data: { priority: newPriority }
			})
			
			// If enabling priority and track is not completed, queue it
			if (newPriority && track.status !== 'completed') {
				await enqueueTrack(trackId!, true)
			}
			
			return data({ 
				success: true, 
				message: `Track ${trackId} ${newPriority ? 'prioritized' : 'deprioritized'}` 
			})
		}
		
		case 'delete-audio': {
			const validationError = validateTrackId('delete-audio')
			if (validationError) return validationError
			
			// Delete the audio file record and reset status
			await prisma.trackAudioFile.update({
				where: { trackId: trackId! },
				data: {
					objectKey: null,
					status: 'pending',
					errorHistory: null,
					retryCount: 0,
					lastAttemptAt: null,
					priority: false
				}
			})
			
			return data({ 
				success: true, 
				message: `Audio file deleted for track ${trackId}` 
			})
		}
		
		case 'requeue-track': {
			const validationError = validateTrackId('requeue-track')
			if (validationError) return validationError
			
			// Reset track status and requeue
			await prisma.trackAudioFile.update({
				where: { trackId: trackId! },
				data: {
					status: 'pending',
					errorHistory: null,
					retryCount: 0,
					lastAttemptAt: null
				}
			})
			
			// Requeue for processing
			await enqueueTrack(trackId!, false)
			
			return data({ 
				success: true, 
				message: `Track ${trackId} requeued for processing` 
			})
		}
		
		default:
			return data({ success: false, message: 'Invalid action' }, { status: 400 })
		}
	} catch (error) {
		console.error('Error in audio queue action:', error)
		return data({ 
			success: false, 
			message: error instanceof Error ? error.message : 'An unexpected error occurred' 
		}, { status: 500 })
	}
}

export default function AudioQueuePage() {
	const loaderData = useLoaderData<typeof loader>()
	const { stats, tracks, totalCount, hasMore, currentPage, currentStatus, workerStatus } = loaderData || {}
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'


	return (
		<div className="container py-8">
			<div className="mb-8">
				<h1 className="text-3xl font-bold">Audio Archive Queue</h1>
				<p className="text-muted-foreground mt-2">
					Manage the background audio archiving process and monitor track status
				</p>
			</div>

			{/* Worker Control Panel */}
			<Card className="mb-8">
				<CardHeader>
					<CardTitle>Worker Control Panel</CardTitle>
					<CardDescription>
						Control the background archiving process
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-4 mb-4">
						<div className="flex items-center gap-2">
							<span className="font-medium">Status:</span>
							<StatusBadge status={workerStatus.status} />
						</div>
						<div className="text-sm text-muted-foreground">
							{workerStatus.message}
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
						<div className="text-sm">
							<span className="font-medium">Currently Processing:</span>
							<span className="ml-2">{workerStatus.currentlyProcessing}/2 tracks</span>
						</div>
						<div className="text-sm">
							<span className="font-medium">Last Queue Run:</span>
							<span className="ml-2">
								{workerStatus.lastQueueRun 
									? new Date(workerStatus.lastQueueRun).toLocaleString('en-US', {
										year: 'numeric',
										month: 'short',
										day: 'numeric',
										hour: '2-digit',
										minute: '2-digit',
										second: '2-digit',
										hour12: true
									})
									: 'Never'
								}
							</span>
						</div>
						{workerStatus.timeUntilNextBreak && (
							<div className="text-sm">
								<span className="font-medium">Next Long Break:</span>
								<span className="ml-2">{workerStatus.timeUntilNextBreak}</span>
							</div>
						)}
					</div>

					<div className="flex gap-2">
						{workerStatus.status === 'running' && (
							<Form method="post">
								<input type="hidden" name="intent" value="pause-worker" />
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{isSubmitting ? 'Pausing...' : 'Pause Archiving'}
								</Button>
							</Form>
						)}
						
						{(workerStatus.status === 'paused' || workerStatus.status === 'long_break') && (
							<Form method="post">
								<input type="hidden" name="intent" value="resume-worker" />
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? 'Resuming...' : 'Resume Archiving'}
								</Button>
							</Form>
						)}
						
						{workerStatus.status === 'long_break' && (
							<Form method="post">
								<input type="hidden" name="intent" value="break-long-pause" />
								<Button type="submit" variant="outline" disabled={isSubmitting}>
									{isSubmitting ? 'Breaking...' : 'Break Long Pause'}
								</Button>
							</Form>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Queue Statistics */}
			<Card className="mb-8">
				<CardHeader>
					<CardTitle>Queue Statistics</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
						<div className="text-center">
							<div className="text-2xl font-bold text-blue-600">{stats.pending}</div>
							<div className="text-sm text-muted-foreground">Pending</div>
							<div className="text-xs text-muted-foreground mt-1">Awaiting processing</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold text-yellow-600">{stats.processing}</div>
							<div className="text-sm text-muted-foreground">Processing</div>
							<div className="text-xs text-muted-foreground mt-1">Currently downloading</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold text-green-600">{stats.completed}</div>
							<div className="text-sm text-muted-foreground">Completed</div>
							<div className="text-xs text-muted-foreground mt-1">Ready for download</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold text-red-600">{stats.failed}</div>
							<div className="text-sm text-muted-foreground">Failed</div>
							<div className="text-xs text-muted-foreground mt-1">Needs retry</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold">{stats.successRate}%</div>
							<div className="text-sm text-muted-foreground">Success Rate</div>
							<div className="text-xs text-muted-foreground mt-1">Overall success</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Track Table */}
			<Card>
				<CardHeader>
					<CardTitle>Tracks</CardTitle>
					<CardDescription>
						{totalCount} total tracks
					</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="flex flex-wrap gap-2 mb-4">
						{(['all', 'pending', 'processing', 'completed', 'failed'] as const).map((status) => (
							<a
								key={status}
								href={`?status=${status}`}
								className={`px-3 py-1 rounded text-sm whitespace-nowrap ${
									currentStatus === status
										? 'bg-primary text-primary-foreground'
										: 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
								}`}
							>
								{status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
							</a>
						))}
					</div>

					<div className="space-y-4">
						{tracks.map((track: any) => {
							const errors = track.errorHistory ? JSON.parse(track.errorHistory) as Array<{code: string, message: string, attemptAt: string, retryCount: number}> : []
							
							return (
								<Card key={track.id} className="hover:shadow-md transition-shadow">
									<CardContent className="p-4">
										<div className="flex items-center justify-between">
											{/* Main track info */}
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-4">
													<div className="flex-1 min-w-0">
														<div className="font-medium truncate">{track.track.title}</div>
														<div className="text-sm text-muted-foreground truncate">
															{track.track.artist} • {track.track.service?.name || 'Unknown'}
														</div>
													</div>
													
													{/* Status and priority */}
													<div className="flex items-center gap-2">
														<StatusBadge status={track.status} />
														{track.priority && track.status !== 'completed' && (
															<Badge variant="outline" className="text-xs">
																Priority
															</Badge>
														)}
													</div>
													
													{/* Retry count */}
													<div className="text-sm text-muted-foreground w-20 text-center">
														<div className="font-medium">Retries</div>
														<div>{track.retryCount}/3</div>
													</div>
													
													{/* Last attempt */}
													<div className="text-sm text-muted-foreground w-40 text-center">
														<div className="font-medium">Last Attempt</div>
														<div>
															{track.lastAttemptAt 
																? new Date(track.lastAttemptAt).toLocaleString('en-US', {
																	month: 'short',
																	day: 'numeric',
																	hour: '2-digit',
																	minute: '2-digit',
																	hour12: true
																})
																: 'Never'
															}
														</div>
													</div>

													{/* Downloaded date */}
													{track.downloadedAt && (
														<div className="text-sm text-muted-foreground w-40 text-center">
															<div className="font-medium">Downloaded</div>
															<div>
																{new Date(track.downloadedAt).toLocaleString('en-US', {
																	month: 'short',
																	day: 'numeric',
																	hour: '2-digit',
																	minute: '2-digit',
																	hour12: true
																})}
															</div>
														</div>
													)}

													{/* Track creation date */}
													<div className="text-sm text-muted-foreground w-40 text-center">
														<div className="font-medium">Created</div>
														<div>
															{new Date(track.track.createdAt).toLocaleString('en-US', {
																month: 'short',
																day: 'numeric',
																hour: '2-digit',
																minute: '2-digit',
																hour12: true
															})}
														</div>
													</div>
													
													{/* Actions */}
													<div className="flex flex-wrap gap-1">
														{track.status === 'failed' && (
															<Form method="post" className="inline">
																<input type="hidden" name="intent" value="retry-track" />
																<input type="hidden" name="trackId" value={track.trackId} />
																<Button type="submit" size="sm" variant="outline" disabled={isSubmitting}>
																	Retry
																</Button>
															</Form>
														)}
														
														{!track.objectKey && track.status !== 'processing' && !track.priority && (
															<Form method="post" className="inline">
																<input type="hidden" name="intent" value="archive-now" />
																<input type="hidden" name="trackId" value={track.trackId} />
																<Button type="submit" size="sm" disabled={isSubmitting}>
																	Archive Now
																</Button>
															</Form>
														)}
														
														{!track.objectKey && track.status !== 'processing' && (
															<Form method="post" className="inline">
																<input type="hidden" name="intent" value="toggle-priority" />
																<input type="hidden" name="trackId" value={track.trackId} />
																<Button 
																	type="submit" 
																	size="sm" 
																	variant={track.priority ? "default" : "outline"}
																	disabled={isSubmitting}
																>
																	{track.priority ? 'Deprioritize' : 'Prioritize'}
																</Button>
															</Form>
														)}

														{track.objectKey && track.status === 'completed' && (
															<>
																<button
																	onClick={() => downloadTrack(track.trackId, `${track.title}.mp3`)}
																	className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 py-1"
																	title="Download audio file"
																>
																	Download
																</button>
																
																<Form method="post" className="inline">
																	<input type="hidden" name="intent" value="delete-audio" />
																	<input type="hidden" name="trackId" value={track.trackId} />
																	<Button 
																		type="submit" 
																		size="sm" 
																		variant="destructive"
																		disabled={isSubmitting}
																		title="Delete audio file and reset track"
																	>
																		Delete
																	</Button>
																</Form>
															</>
														)}
														
														{track.objectKey && track.status === 'failed' && (
															<Form method="post" className="inline">
																<input type="hidden" name="intent" value="requeue-track" />
																<input type="hidden" name="trackId" value={track.trackId} />
																<Button 
																	type="submit" 
																	size="sm" 
																	variant="outline"
																	disabled={isSubmitting}
																	title="Requeue track for processing"
																>
																	Requeue
																</Button>
															</Form>
														)}
													</div>
												</div>
											</div>
										</div>

										{/* Expandable error details */}
										{track.errorHistory && errors.length > 0 && (
											<div className="mt-3 pt-3 border-t">
												<Accordion type="single" collapsible>
													<AccordionItem value="errors" className="border-0">
														<AccordionTrigger className="py-2 text-sm text-muted-foreground hover:text-foreground">
															Error History ({errors.length} error{errors.length !== 1 ? 's' : ''})
														</AccordionTrigger>
														<AccordionContent className="pt-2">
															<div className="space-y-2">
																{errors.map((error: any, index: number) => (
																	<div key={index} className="p-2 bg-red-50 dark:bg-red-950 rounded border-l-2 border-red-400">
																		<div className="font-medium text-red-800 dark:text-red-200 text-sm">
																			{error.code}
																		</div>
																		<div className="text-red-700 dark:text-red-300 text-xs mt-1">
																			{error.message}
																		</div>
																		<div className="text-xs text-red-600 dark:text-red-400 mt-1">
																			<span className="font-medium">Attempt {error.retryCount}</span>
																			<span className="mx-1">•</span>
																			<span>{new Date(error.attemptAt).toLocaleString('en-US', {
																				month: 'short',
																				day: 'numeric',
																				hour: '2-digit',
																				minute: '2-digit',
																				second: '2-digit',
																				hour12: true
																			})}</span>
																		</div>
																	</div>
																))}
															</div>
														</AccordionContent>
													</AccordionItem>
												</Accordion>
											</div>
										)}
									</CardContent>
								</Card>
							)
						})}
					</div>

					{/* Pagination */}
					{hasMore && (
						<div className="flex justify-center mt-4">
							<Button asChild>
								<a href={`?status=${currentStatus}&page=${currentPage + 1}`}>
									Load More
								</a>
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}

export function getSitemapEntries() {
	return null
}