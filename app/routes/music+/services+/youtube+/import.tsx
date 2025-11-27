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
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Field, ErrorList } from '#app/components/forms'
import { PreviewCard } from '#app/components/preview-card'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { handleValidationError } from '#app/utils/error-handlers.server'
import { validateAction, validateRequiredString, createValidationErrorResponse } from '#app/utils/form-validation'
import { formatDuration } from '#app/utils/format-duration'

import { getServiceImportHandler, importTrackDirectly } from '#app/utils/service-import.server'
import { redirectWithToast } from '#app/utils/toast.server'

export const handle: BreadcrumbHandle = {
	breadcrumb: <Icon name="download">Import</Icon>,
}

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
	
	// Validate action
	const validActions = ['cancel', 'preview', 'import'] as const
	const actionValidation = validateAction(action, validActions)
	if (!actionValidation.success) {
		return createValidationErrorResponse(actionValidation.message!)
	}
	
	// Handle cancel request
	if (action === 'cancel') {
		return redirect(`/music/services/youtube/import`)
	}

	// Handle preview request
	if (action === 'preview') {
		const urlValidation = validateRequiredString(url, 'Video URL')
		if (!urlValidation.success) {
			return createValidationErrorResponse(urlValidation.message!)
		}
		
		try {
			// Extract video ID from URL
			const { extractYouTubeVideoId } = await import('#app/utils/track-validation.server.ts')
			const extractedVideoId = extractYouTubeVideoId(url)
			
			if (!extractedVideoId) {
				return data({ error: `Invalid ${serviceName} URL format` }, { status: 400 })
			}
			
			// Fetch video details and return them directly
			const handler = getServiceImportHandler(serviceName)
			const videoDetails = await handler.getVideoDetails(extractedVideoId)
			
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
					externalId: extractedVideoId,
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
			// Log error for debugging but don't expose internal details
			console.error(`${serviceName || 'unknown'} preview error:`, error)
			
			return handleValidationError(error, 'preview')
		}
	}
	
	// Handle import request
	if (action === 'import') {
		const videoIdValidation = validateRequiredString(videoId, 'Video ID')
		if (!videoIdValidation.success) {
			return createValidationErrorResponse(videoIdValidation.message!)
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
			
			// Success - return data
			if (result.track) {
				return data({
					success: true,
					track: result.track,
				})
			} else {
				return data({
					success: true,
				})
			}
			
		} catch (error) {
			// Log error for debugging but don't expose internal details
			console.error(`${serviceName} import error:`, error)
			
			return handleValidationError(error, 'import')
		}
	}
	
	// This should never be reached due to validation above
	throw new Error('Unreachable code')
}

export default function YouTubeImportPage() {
	const { service } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	
	// Check if we have preview data
	const hasPreview = actionData && 'previewData' in actionData && actionData.previewData
	
	// Computed values for preview card
	const previewConfig = {
		title: hasPreview && actionData.previewData.alreadyExists 
			? "Track Already in Library" 
			: "Preview Track",
		description: hasPreview && actionData.previewData.alreadyExists
			? "This track is already in your library. You can view it or continue browsing."
			: "Review the track details before adding it to your library",
		icon: hasPreview && actionData.previewData.alreadyExists 
			? "check-circled" as const
			: "magnifying-glass" as const,
		iconColor: hasPreview && actionData.previewData.alreadyExists 
			? "text-green-600" 
			: "text-muted-foreground"
	}
	
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
						Back
					</Link>
				</Button>
			</div>
			
			<p className="text-muted-foreground">
				Import tracks from {service.displayName} by pasting a video URL. You'll be able to preview the track before adding it to your library.
			</p>

			{/* Success message */}
			{(() => {
				if (!actionData || typeof actionData !== 'object' || actionData === null) return null
				if (!('success' in actionData) || !actionData.success) return null
				if (!('track' in actionData) || !actionData.track || typeof actionData.track !== 'object' || actionData.track === null) return null
				
				const track = actionData.track as { title?: string; artist?: string }
				const message = track.title && track.artist
					? `"${track.title}" by ${track.artist} has been added to your library.`
					: 'Track has been added to your library.'
				
				return (
					<div className="rounded-lg border border-green-200 bg-green-50 p-4">
						<div className="flex items-center gap-2">
							<Icon name="check-circled" className="h-5 w-5 text-green-600" />
							<div>
								<h3 className="font-medium text-green-800">Track Imported!</h3>
								<p className="text-sm text-green-700">{message}</p>
							</div>
						</div>
					</div>
				)
			})()}

			{!hasPreview ? (
				// Show URL input form
				<div className="rounded-lg border bg-card p-6">
					<Form method="post" action={`/music/services/youtube/import`} className="space-y-4">
						<input type="hidden" name="action" value="preview" />
						<Field
							labelProps={{ htmlFor: 'url', children: `${service.displayName} URL` }}
							inputProps={{
								id: 'url',
								name: 'url',
								type: 'url',
								placeholder: `${service.baseUrl}/...`,
								required: true,
								defaultValue: '',
								className: 'flex-1'
							}}
							errors={actionData && 'field' in actionData && actionData.field === 'url' && 'error' in actionData ? [actionData.error] : undefined}
						/>
						<div className="flex gap-2">
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
						
						{actionData && 'error' in actionData && (!('field' in actionData) || actionData.field !== 'url') && (
							<ErrorList errors={[actionData.error]} />
						)}
					</Form>
				</div>
			) : (
				// Show preview with progressive enhancement
				<div className="space-y-6">
					<PreviewCard
						title={previewConfig.title}
						description={previewConfig.description}
						icon={previewConfig.icon}
						iconColor={previewConfig.iconColor}
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
