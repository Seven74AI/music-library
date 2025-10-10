import { data, Link } from 'react-router'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getTrackTitle } from '#app/utils/breadcrumb-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { downloadTrack } from '#app/utils/download.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { getAudioSrc } from '#app/utils/misc.tsx'
import { type Route } from './+types/library.$trackId.ts'

export const handle: BreadcrumbHandle = {
	breadcrumb: ({ data }) => getTrackTitle(data),
}

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireUserId(request)
	
	const track = await prisma.track.findUnique({
		where: { id: params.trackId },
		select: {
			id: true,
			title: true,
			artist: true,
			createdAt: true,
			updatedAt: true,
			audioFile: {
				select: {
					id: true,
					objectKey: true,
					fileName: true,
					fileSize: true,
					mimeType: true,
					status: true,
					errorHistory: true,
					retryCount: true,
					downloadedAt: true,
					lastAttemptAt: true,
				},
			},
			duration: true,
		},
	})

	if (!track) {
		throw new Response('Track not found', { status: 404 })
	}

	return data({ track })
}

export default function TrackRoute({ loaderData }: Route.ComponentProps) {
	const { track } = loaderData

	return (
		<div className="py-8">
			<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Icon name="file-text" className="text-muted-foreground" />
					<h2 className="text-h2">{track.title}</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/library">
						<Icon name="arrow-left" className="mr-2" />
						Back
					</Link>
				</Button>
			</div>
					<div className="flex flex-col gap-6">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<h3 className="text-lg font-semibold mb-2">Track Information</h3>
								<div className="space-y-2">
									<div>
										<span className="text-sm font-medium text-muted-foreground">Title:</span>
										<p className="text-base">{track.title}</p>
									</div>
									<div>
										<span className="text-sm font-medium text-muted-foreground">Artist:</span>
										<p className="text-base">{track.artist}</p>
									</div>
									<div>
										<span className="text-sm font-medium text-muted-foreground">Duration:</span>
										<p className="text-base">
											{track.duration ? (
												formatDuration(track.duration)
											) : (
												<span className="text-muted-foreground flex items-center gap-1">
													<Icon name="clock" className="h-4 w-4" />
													Unknown
												</span>
											)}
										</p>
									</div>
									<div>
										<span className="text-sm font-medium text-muted-foreground">Added:</span>
										<p className="text-base">{new Date(track.createdAt).toLocaleDateString()}</p>
									</div>
								</div>
							</div>
							
							<div>
								<h3 className="text-lg font-semibold mb-2">Archive Status</h3>
								<div className="space-y-2">
									<div>
										<span className="text-sm font-medium text-muted-foreground">Status:</span>
										<div className="flex items-center gap-2">
											{track.audioFile?.status === 'pending' ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">
															Pending
														</span>
													</TooltipTrigger>
													<TooltipContent>
														<p>Track is in the processing queue and will be archived soon</p>
													</TooltipContent>
												</Tooltip>
											) : (
												<span className={`text-xs px-2 py-1 rounded ${
													track.audioFile?.status === 'completed' ? 'bg-green-100 text-green-800' :
													track.audioFile?.status === 'processing' ? 'bg-blue-100 text-blue-800' :
													track.audioFile?.status === 'failed' ? 'bg-red-100 text-red-800' :
													'bg-gray-100 text-gray-800'
												}`}>
													{track.audioFile?.status === 'completed' ? 'Ready for Download' :
													 track.audioFile?.status === 'processing' ? 'Processing' :
													 track.audioFile?.status === 'failed' ? 'Failed' :
													 'Not Archived'}
												</span>
											)}
										</div>
									</div>
									{track.audioFile?.status === 'failed' && track.audioFile.errorHistory && (
										<div>
											<span className="text-sm font-medium text-muted-foreground">Latest Error:</span>
											<div className="text-sm text-red-600 bg-red-50 p-2 rounded">
												{(() => {
													try {
														const errors = JSON.parse(track.audioFile.errorHistory) as Array<{code: string, message: string}>
														const latestError = errors[errors.length - 1]
														return latestError ? `${latestError.code}: ${latestError.message}` : 'Unknown error'
													} catch {
														return 'Error parsing error history'
													}
												})()}
											</div>
										</div>
									)}
									{track.audioFile?.retryCount && track.audioFile.retryCount > 0 && (
										<div>
											<span className="text-sm font-medium text-muted-foreground">Retry Count:</span>
											<p className="text-base">{track.audioFile.retryCount}/3</p>
										</div>
									)}
									{track.audioFile?.lastAttemptAt && (
										<div>
											<span className="text-sm font-medium text-muted-foreground">Last Attempt:</span>
											<p className="text-base">{new Date(track.audioFile.lastAttemptAt).toLocaleString()}</p>
										</div>
									)}
									{track.audioFile?.downloadedAt && (
										<div>
											<span className="text-sm font-medium text-muted-foreground">Downloaded:</span>
											<p className="text-base">{new Date(track.audioFile.downloadedAt).toLocaleString()}</p>
										</div>
									)}
								</div>
							</div>
						</div>
						
						{track.audioFile?.objectKey && track.audioFile.status === 'completed' && (
							<>
								<div>
									<h3 className="text-lg font-semibold mb-4">Audio Playback</h3>
									<div className="space-y-4">
										<audio 
											src={getAudioSrc(track.audioFile.objectKey) || undefined}
											controls
											preload="metadata"
											className="w-full"
										>
											Your browser does not support audio playback.
										</audio>
										
										<div className="flex gap-2">
											<Button 
												onClick={() => downloadTrack(track.id, `${track.title}.mp3`)}
												aria-label={`Download ${track.title} as MP3`}
											>
												<Icon name="download" className="mr-2" />
												Download MP3
											</Button>
										</div>
									</div>
								</div>
								
								<div>
									<h3 className="text-lg font-semibold mb-4">File Information</h3>
									<div className="bg-muted rounded-lg p-4">
										<div className="text-sm space-y-1">
											<div>
												<span className="font-medium">File:</span> {track.audioFile.fileName || `${track.title}.mp3`}
											</div>
											<div>
												<span className="font-medium">Size:</span> {
													track.audioFile.fileSize 
														? `${Math.round(track.audioFile.fileSize / 1024 / 1024 * 100) / 100} MB`
														: 'Unknown'
												}
											</div>
											<div>
												<span className="font-medium">Type:</span> {track.audioFile.mimeType || 'audio/mpeg'}
											</div>
										</div>
									</div>
								</div>
							</>
						)}
			</div>
		</div>
		</div>
	)
}
