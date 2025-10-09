import {
  data,
  Form,
  Link,
  useNavigation,
  redirect,
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from 'react-router'
import { PreviewCard } from '#app/components/preview-card'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { Input } from '#app/components/ui/input'
import { Label } from '#app/components/ui/label'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { formatDuration } from '#app/utils/format-duration'
import { getServiceImportHandler, importTrackDirectly } from '#app/utils/service-import.server'
import { redirectWithToast } from '#app/utils/toast.server'

export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserId(request)
	
	const service = await prisma.service.findUnique({
		where: { name: YOUTUBE_SERVICE.NAME }
	})
	
	if (!service) {
		throw new Response('YouTube service not found', { status: 404 })
	}
	
	return data({ service })
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	
	const formData = await request.formData()
	const url = formData.get('url') as string
	const videoId = formData.get('videoId') as string
	const action = formData.get('action') as string
	const serviceName = YOUTUBE_SERVICE.NAME
	
	// Handle cancel request
	if (action === 'cancel') {
		return redirect(`/music/services/youtube/import`)
	}

	// Handle preview request
	if (action === 'preview') {
		if (!url || url.trim().length === 0) {
			return data({ error: 'Video URL is required' }, { status: 400 })
		}
		
		try {
			// Extract video ID from URL
			const { extractYouTubeVideoId } = await import('#app/utils/track-validation.server.ts')
			const extractedVideoId = extractYouTubeVideoId(url)
			
			if (!extractedVideoId) {
				return data({ error: `Invalid ${serviceName} URL format` }, { status: 400 })
			}
			
			// Fetch video details and return them directly
			console.log('Getting service import handler for:', serviceName)
			const handler = getServiceImportHandler(serviceName)
			console.log('Handler obtained, calling getVideoDetails with:', extractedVideoId)
			const videoDetails = await handler.getVideoDetails(extractedVideoId)
			console.log('Video details obtained:', videoDetails)
			
			// Check if track already exists for this user
			const { prisma } = await import('#app/utils/db.server.ts')
			
			// First get the service
			const service = await prisma.service.findUnique({
				where: { name: serviceName }
			})
			
			if (!service) {
				console.error(`Service not found: ${serviceName}`)
				return data({ error: `Service not found: ${serviceName}` }, { status: 400 })
			}
			
			const existingTrack = await prisma.track.findFirst({
				where: {
					serviceId: service.id,
					serviceProviderId: extractedVideoId,
					userTracks: {
						some: {
							userId: userId
						}
					}
				},
				include: {
					userTracks: {
						where: {
							userId: userId
						}
					}
				}
			})
			
			// Return preview data with existing track info
			return data({ 
				previewData: {
					serviceName,
					videoId: extractedVideoId,
					videoDetails,
					alreadyExists: !!existingTrack,
					existingTrackId: existingTrack?.id
				}
			})
			
		} catch (error) {
			console.error(`${serviceName || 'unknown'} preview error:`, error)
			
			return data({ 
				error: error instanceof Error ? error.message : 'Failed to fetch track details. Please try again.' 
			}, { status: 400 })
		}
	}
	
	// Handle import request
	if (action === 'import') {
		if (!videoId) {
			return data({ error: 'Video ID is required' }, { status: 400 })
		}
		
		try {
			// Import the track directly
			const result = await importTrackDirectly(serviceName, videoId, userId)
			
			if (!result.success) {
				// Special handling for already existing tracks - redirect with toast
				if (result.errorType === 'ALREADY_EXISTS' && result.trackId) {
					return redirectWithToast('/library', {
						title: 'Track Already in Library',
						description: result.error || 'This track is already in your library.',
						type: 'message',
						action: {
							label: 'View Track',
							href: `/library/${result.trackId}`
						}
					})
				}
				
				return data({ error: result.error }, { status: 400 })
			}
			
			// Success - redirect to library with success toast
			if (result.track) {
				return redirectWithToast('/library', {
					title: 'Track Imported!',
					description: `"${result.track.title}" by ${result.track.artist} has been added to your library.`,
					type: 'success',
					duration: 10000,
					action: {
						label: 'View Track',
						href: `/library/${result.track.id}`
					}
				})
			} else {
				return redirectWithToast('/library', {
					title: 'Track Imported!',
					description: 'Track has been added to your library.',
					type: 'success',
					duration: 10000
				})
			}
			
		} catch (error) {
			console.error(`${serviceName} import error:`, error)
			
			return data({ 
				error: error instanceof Error ? error.message : 'Failed to import track. Please try again.' 
			}, { status: 400 })
		}
	}
	
	return data({ error: 'Invalid action' }, { status: 400 })
}

export default function YouTubeImportPage() {
	const { service } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	
	// Check if we have preview data
	const hasPreview = actionData && 'previewData' in actionData && actionData.previewData
	
	// Computed values for preview card
	const previewTitle = hasPreview && actionData.previewData.alreadyExists 
		? "Track Already in Library" 
		: "Preview Track"
	
	const previewDescription = hasPreview && actionData.previewData.alreadyExists
		? "This track is already in your library. You can view it or continue browsing."
		: "Review the track details before adding it to your library"
	
	const previewIcon = hasPreview && actionData.previewData.alreadyExists 
		? "check-circled" 
		: "magnifying-glass"
	
	const previewIconColor = hasPreview && actionData.previewData.alreadyExists 
		? "text-green-600" 
		: "text-muted-foreground"
	
	// Computed primary action
	const primaryAction = hasPreview && actionData.previewData.alreadyExists ? {
		type: 'link' as const,
		label: 'View Track',
		icon: 'eye-open' as const,
		href: `/library/${actionData.previewData.existingTrackId}`
	} : {
		type: 'submit' as const,
		label: isSubmitting ? 'Adding to Library...' : 'Add to Library',
		icon: isSubmitting ? 'update' as const : 'plus' as const,
		formAction: `/music/services/youtube/import`,
		formData: { 
			action: 'import',
			videoId: hasPreview ? actionData.previewData.videoId : ''
		}
	}
	
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					{service.logoUrl ? (
						<img 
							src={service.logoUrl} 
							alt={`${service.displayName} logo`}
							className="w-8 h-8 rounded"
						/>
					) : (
						<Icon name="link-2" className="text-muted-foreground" />
					)}
					<h2 className="text-h2">Import from {service.displayName}</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/music/services/youtube">
						<Icon name="arrow-left" className="mr-2" />
						Back to Import
					</Link>
				</Button>
			</div>
			
			<p className="text-muted-foreground">
				Import tracks from {service.displayName} by pasting a video URL. You'll be able to preview the track before adding it to your library.
			</p>

			{!hasPreview ? (
				// Show URL input form
				<div className="rounded-lg border bg-card p-6">
					<Form method="post" action={`/music/services/youtube/import`} className="space-y-4">
						<input type="hidden" name="action" value="preview" />
						<div className="space-y-2">
							<Label htmlFor="url">{service.displayName} URL</Label>
							<div className="flex gap-2">
								<Input
									id="url"
									name="url"
									type="url"
									placeholder={`${service.baseUrl}/...`}
									required
									defaultValue={''}
									className="flex-1"
								/>
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<>
											<Icon name="update" className="mr-2 animate-spin" />
											Loading...
										</>
									) : (
										<>
											<Icon name="magnifying-glass" className="mr-2" />
											Preview Track
										</>
									)}
								</Button>
							</div>
							<p className="text-sm text-muted-foreground">
								Paste a {service.displayName} URL to preview and import it to your library
							</p>
						</div>
						
						{actionData && 'error' in actionData && (
							<div className="rounded-md bg-destructive/15 p-3">
								<div className="flex items-center gap-2">
									<Icon name="question-mark-circled" className="h-4 w-4 text-destructive" />
									<p className="text-sm text-destructive font-medium">Preview Failed</p>
								</div>
								<p className="text-sm text-destructive mt-1">{actionData.error}</p>
							</div>
						)}
					</Form>
				</div>
			) : (
				// Show preview with progressive enhancement
				<div className="space-y-6">
					<PreviewCard
						title={previewTitle}
						description={previewDescription}
						icon={previewIcon}
						iconColor={previewIconColor}
						thumbnail={{
							src: actionData.previewData.videoDetails.thumbnailUrl,
							alt: `${actionData.previewData.videoDetails.title} thumbnail`
						}}
						content={{
							title: actionData.previewData.videoDetails.title,
							subtitle: actionData.previewData.videoDetails.artist,
							badges: [
								{ label: formatDuration(actionData.previewData.videoDetails.duration) },
								{ label: service.displayName, variant: 'outline' }
							]
						}}
						error={actionData && 'error' in actionData ? String(actionData.error) : undefined}
						isSubmitting={isSubmitting}
						secondaryAction={{
							type: 'submit',
							label: 'Cancel',
							icon: 'cross-1',
							variant: 'outline',
							formAction: `/music/services/youtube/import`,
							formData: { action: 'cancel' }
						}}
						primaryAction={primaryAction}
					/>
				</div>
			)}
		</div>
	)
}
