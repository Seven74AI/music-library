import { useState } from 'react'
import {
	data,
	Form,
	useActionData,
	Link,
	type LoaderFunctionArgs,
	type ActionFunctionArgs,
} from 'react-router'

import { Button } from '#app/components/ui/button'
import { Card, CardContent } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { Input } from '#app/components/ui/input'
import {
	YOUTUBE_IMPORT_INTENTS,
	validateImportIntent,
	getIntentErrorMessage,
	YOUTUBE_PAGE_TYPES,
} from '#app/types/youtube-intents'
import { requireUserId } from '#app/utils/auth.server'
import { handleLoaderError } from '#app/utils/error-handlers.server'
import { proxyClientActionToServer } from '#app/utils/server-proxy-client-action.ts'
import { importTrackDirectly } from '#app/utils/service-import.server'
import { searchYouTubeVideos } from '#app/utils/youtube-search.server'
import { type Route } from './+types/import.ts'

/**
 * Loader function for YouTube import page.
 * Renders the search/import UI — no data needed initially.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserId(request)
	return data({})
}

/**
 * Action function for YouTube import page.
 * Handles SEARCH and IMPORT intents.
 */
export async function action({ request }: ActionFunctionArgs) {
	await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (!validateImportIntent(intent)) {
		return data(
			{
				status: 'error',
				message: getIntentErrorMessage(YOUTUBE_PAGE_TYPES.IMPORT),
			},
			{ status: 400 },
		)
	}

	try {
		switch (intent) {
			case YOUTUBE_IMPORT_INTENTS.SEARCH: {
				const query = formData.get('query')
				if (!query || typeof query !== 'string' || query.trim().length === 0) {
					return data(
						{ status: 'error', message: 'Please enter a search query or YouTube URL.' },
						{ status: 400 },
					)
				}

				const results = await searchYouTubeVideos(query.trim(), 10)
				return data({ status: 'success', results })
			}

			case YOUTUBE_IMPORT_INTENTS.IMPORT: {
				const videoIdOrUrl = formData.get('videoIdOrUrl')
				if (
					!videoIdOrUrl ||
					typeof videoIdOrUrl !== 'string' ||
					videoIdOrUrl.trim().length === 0
				) {
					return data(
						{ status: 'error', message: 'Please provide a video ID or URL to import.' },
						{ status: 400 },
					)
				}

				const result = await importTrackDirectly(videoIdOrUrl.trim())
				return data({ status: result.success ? 'success' : 'error', ...result })
			}

			default:
				return data({ status: 'error', message: 'Invalid action' }, { status: 400 })
		}
	} catch (error) {
		console.error('YouTube import action error:', error)
		return data({
			status: 'error',
			message:
				error instanceof Error ? error.message : 'An unexpected error occurred',
		})
	}
}

interface VideoData {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string
	serviceUrl: string
	publishedAt: string
}

export default function YouTubeImportPage() {
	const actionData = useActionData<typeof action>()
	const [searchQuery, setSearchQuery] = useState('')
	const [importing, setImporting] = useState<string | null>(null)

	const results = actionData?.status === 'success' && 'results' in actionData
		? (actionData.results as VideoData[])
		: []

	const importResult = actionData?.status === 'success' && 'trackId' in actionData
		? actionData
		: null
	const importError =
		actionData?.status === 'error' ? actionData : null

	const errorMessage =
		importError && 'message' in importError
			? importError.message
			: null

	return (
		<div className="py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services/youtube">
							<Icon name="arrow-left" className="mr-2" />
							Back
						</Link>
					</Button>
				</div>
				<div className="flex items-center gap-4">
					<img
						src="/logos/youtube.svg"
						alt="YouTube logo"
						className="w-8 h-8"
					/>
					<div>
						<h1 className="text-3xl font-bold">Import from YouTube</h1>
						<p className="text-muted-foreground mt-1">
							Search for a YouTube video and import it directly to your library
						</p>
					</div>
				</div>
			</div>

			{/* Search Form */}
			<Card className="mb-6">
				<CardContent className="pt-6">
					<Form method="post" className="flex gap-4">
						<input
							type="hidden"
							name="intent"
							value={YOUTUBE_IMPORT_INTENTS.SEARCH}
						/>
						<div className="flex-1">
							<Input
								type="text"
								name="query"
								placeholder="Enter YouTube URL or search by artist/song..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full"
							/>
						</div>
						<Button type="submit">
							<Icon name="magnifying-glass" className="mr-2 h-4 w-4" />
							Search
						</Button>
					</Form>
				</CardContent>
			</Card>

			{/* Import Result */}
			{importResult && (
				<div className="mb-6 rounded-md bg-green-50 dark:bg-green-950 p-4">
					<div className="flex items-center gap-2">
						<Icon
							name="check-circled"
							className="h-4 w-4 text-green-600 dark:text-green-400"
						/>
						<p className="text-sm text-green-800 dark:text-green-200 font-medium">
							Track Imported Successfully
						</p>
					</div>
					<p className="text-sm text-green-700 dark:text-green-300 mt-1">
						Track has been added to your library and queued for audio archiving.
						{importResult.action === 'updated'
							? ' (Existing track updated)'
							: ' (New track created)'}
					</p>
				</div>
			)}

			{/* Error Message */}
			{importError && (
				<div className="mb-6 rounded-md bg-destructive/15 p-4">
					<div className="flex items-center gap-2">
						<Icon
							name="question-mark-circled"
							className="h-4 w-4 text-destructive"
						/>
						<p className="text-sm text-destructive font-medium">Error</p>
					</div>
					<p className="text-sm text-destructive mt-1">
						{errorMessage}
					</p>
				</div>
			)}

			{/* Search Results */}
			{results.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-xl font-semibold">
						Search Results ({results.length})
					</h2>
					<div className="grid gap-4">
						{results.map((video) => (
							<Card key={video.id}>
								<CardContent className="pt-6">
									<div className="flex gap-4 items-start">
										{video.thumbnailUrl && (
											<img
												src={video.thumbnailUrl}
												alt={video.title}
												className="w-24 h-16 rounded object-cover flex-shrink-0"
											/>
										)}
										<div className="flex-1 min-w-0">
											<h3 className="font-semibold truncate">
												{video.title}
											</h3>
											<p className="text-sm text-muted-foreground">
												{video.artist}
											</p>
											{video.duration && (
												<p className="text-xs text-muted-foreground">
													{Math.floor(video.duration / 60)}:
													{String(video.duration % 60).padStart(2, '0')}
												</p>
											)}
										</div>
										<div className="flex gap-2 flex-shrink-0">
											<Form method="post" className="inline">
												<input
													type="hidden"
													name="intent"
													value={YOUTUBE_IMPORT_INTENTS.IMPORT}
												/>
												<input
													type="hidden"
													name="videoIdOrUrl"
													value={video.serviceUrl}
												/>
												<Button
													type="submit"
													size="sm"
													disabled={importing === video.id}
													onClick={() => setImporting(video.id)}
												>
													<Icon name="download" className="mr-1 h-3 w-3" />
													{importing === video.id ? 'Importing...' : 'Import'}
												</Button>
											</Form>
											<a
												href={video.serviceUrl}
												target="_blank"
												rel="noopener noreferrer"
											>
												<Button variant="outline" size="sm" type="button">
													<Icon name="link-2" className="h-3 w-3" />
												</Button>
											</a>
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{/* No Results */}
			{actionData?.status === 'success' &&
				'results' in actionData &&
				(results as unknown[]).length === 0 && (
					<div className="text-center py-12">
						<Icon
							name="magnifying-glass"
							className="h-12 w-12 text-muted-foreground mx-auto mb-4"
						/>
						<p className="text-muted-foreground">
							No results found for your search. Try a different query.
						</p>
					</div>
				)}
		</div>
	)
}

export async function clientAction(args: Route.ClientActionArgs) {
	return proxyClientActionToServer(args)
}
