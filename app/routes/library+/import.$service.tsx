import { data, Form, Link, useNavigation } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { importTrackDirectly, ServiceAPIError } from '#app/utils/service-import.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/import.$service.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireUserId(request)
	
	const service = await prisma.service.findUnique({
		where: { name: params.service }
	})
	
	if (!service) {
		throw new Response('Service not found', { status: 404 })
	}
	
	return data({ service })
}

export async function action({ request, params }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	
	const formData = await request.formData()
	const url = formData.get('url') as string
	const serviceName = params.service
	
	if (!url || url.trim().length === 0) {
		return data({ error: 'Video URL is required' }, { status: 400 })
	}
	
	if (!serviceName) {
		return data({ error: 'Service name is required' }, { status: 400 })
	}
	
	try {
		// Extract video ID from URL
		const { extractYouTubeVideoId } = await import('#app/utils/track-validation.server.ts')
		const videoId = extractYouTubeVideoId(url)
		
		if (!videoId) {
			return data({ error: `Invalid ${serviceName} URL format` }, { status: 400 })
		}
		
		// Import the track directly
		const result = await importTrackDirectly(serviceName, videoId, userId)
		
		if (!result.success) {
			// Gestion spéciale pour les tracks déjà existantes - ajouter un lien dans le message
			if (result.errorType === 'ALREADY_EXISTS' && result.trackId) {
				return data({ 
					error: `${result.error} <a href="/library/${result.trackId}" class="underline text-primary hover:text-primary/80">View track</a>`,
					errorType: 'ALREADY_EXISTS',
					trackId: result.trackId
				}, { status: 400 })
			}
			
			// Autres erreurs
			return data({ error: result.error }, { status: 400 })
		}
		
		// Success - redirect to import page with contextual toast
		return redirectWithToast('/library/import/youtube', {
			title: 'Track Imported!',
			description: `"${result.track.title}" by ${result.track.artist} has been added to your library.`,
			type: 'success',
			duration: 10000, // 10 secondes pour laisser le temps de cliquer
			action: {
				label: 'View Track',
				href: `/library/${result.track.id}` // Lien vers la track spécifique
			}
		})
		
	} catch (error) {
		console.error(`${serviceName} import error:`, error)
		
		if (error instanceof ServiceAPIError) {
			return redirectWithToast('/library/import/youtube', {
				title: 'Import Failed',
				description: (error as ServiceAPIError).message,
				type: 'error',
				duration: 8000,
				action: {
					label: 'Retry',
					href: '/library/import/youtube'
				}
			})
		}
		
		return redirectWithToast('/library/import/youtube', {
			title: 'Import Failed',
			description: `Failed to import ${serviceName} video. Please try again.`,
			type: 'error',
			duration: 8000,
			action: {
				label: 'Retry',
				href: '/library/import/youtube'
			}
		})
	}
}

export default function ImportFromServicePage({ loaderData, actionData }: Route.ComponentProps) {
	const navigation = useNavigation()
	const isSearching = navigation.formAction === `/library/import/${loaderData.service.name}`
	
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					{loaderData.service.logoUrl ? (
						<img 
							src={loaderData.service.logoUrl} 
							alt={`${loaderData.service.displayName} logo`}
							className="w-8 h-8 rounded"
						/>
					) : (
						<Icon name="link-2" className="text-muted-foreground" />
					)}
					<h2 className="text-h2">Import from {loaderData.service.displayName}</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/library/import">
						<Icon name="arrow-left" className="mr-2" />
						Back to Import
					</Link>
				</Button>
			</div>
			
			<p className="text-muted-foreground">
				Import tracks from {loaderData.service.displayName} by pasting a video URL directly into your library.
			</p>

			<div className="rounded-lg border bg-card p-6">
				<Form method="post" action={`/library/import/${loaderData.service.name}`} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="url">{loaderData.service.displayName} URL</Label>
						<div className="flex gap-2">
							<Input
								id="url"
								name="url"
								type="url"
								placeholder={`https://${loaderData.service.baseUrl}/...`}
								required
								defaultValue={(actionData && 'url' in actionData && actionData.url) ? String(actionData.url) : ''}
								className="flex-1"
							/>
							<Button type="submit" disabled={isSearching}>
								{isSearching ? (
									<>
										<Icon name="update" className="mr-2 animate-spin" />
										Importing...
									</>
								) : (
									<>
										<Icon name="plus" className="mr-2" />
										Import
									</>
								)}
							</Button>
						</div>
						<p className="text-sm text-muted-foreground">
							Paste a {loaderData.service.displayName} URL to import it directly to your library
						</p>
					</div>
					
					{(actionData && 'error' in actionData) && (
						<div className="rounded-md bg-destructive/15 p-3">
							<div className="flex items-center gap-2">
								<Icon name="question-mark-circled" className="h-4 w-4 text-destructive" />
								<p className="text-sm text-destructive font-medium">Import Failed</p>
							</div>
							<p 
								className="text-sm text-destructive mt-1"
								dangerouslySetInnerHTML={{ __html: actionData.error || '' }}
							/>
							{'errorCode' in actionData && actionData.errorCode === 'QUOTA_EXCEEDED' && (
								<p className="text-xs text-destructive mt-2">
									API quota exceeded. Please try again later or contact support.
								</p>
							)}
							{'errorCode' in actionData && actionData.errorCode === 'NO_API_KEY' && (
								<p className="text-xs text-destructive mt-2">
									Service integration is not configured. Please contact support.
								</p>
							)}
							{'errorCode' in actionData && actionData.errorCode === 'VIDEO_NOT_FOUND' && (
								<p className="text-xs text-destructive mt-2">
									The video could not be found. Please check the URL and try again.
								</p>
							)}
						</div>
					)}
				</Form>
			</div>
		</div>
	)
}
