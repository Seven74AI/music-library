// @context7: Prisma, React, React Router, Tailwind CSS, TypeScript
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - Prisma
    - React
    - React Router
    - Tailwind CSS
    - TypeScript
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)

    Context7 Instructions:
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
import { data, Link  } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/library.$trackId.ts'

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
				},
			},
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
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Icon name="file-text" className="text-muted-foreground" />
					<h2 className="text-h2">{track.title}</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/library">
						<Icon name="arrow-left" className="mr-2" />
						Back to Library
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
										<span className="text-sm font-medium text-muted-foreground">Added:</span>
										<p className="text-base">{new Date(track.createdAt).toLocaleDateString()}</p>
									</div>
								</div>
							</div>
							
							{track.audioFile && (
								<div>
									<h3 className="text-lg font-semibold mb-2">Audio File</h3>
									<div className="space-y-2">
										<div>
											<span className="text-sm font-medium text-muted-foreground">File:</span>
											<p className="text-base">{track.audioFile.fileName || 'Unknown'}</p>
										</div>
										<div>
											<span className="text-sm font-medium text-muted-foreground">Size:</span>
											<p className="text-base">
												{track.audioFile.fileSize 
													? `${Math.round(track.audioFile.fileSize / 1024 / 1024 * 100) / 100} MB`
													: 'Unknown'
												}
											</p>
										</div>
										<div>
											<span className="text-sm font-medium text-muted-foreground">Type:</span>
											<p className="text-base">{track.audioFile.mimeType || 'Unknown'}</p>
										</div>
									</div>
								</div>
							)}
						</div>
						
						{track.audioFile && (
							<div>
								<h3 className="text-lg font-semibold mb-4">Audio Player</h3>
								<div className="bg-muted rounded-lg p-4">
									<audio 
										controls 
										className="w-full max-w-md"
										preload="metadata"
									>
										<source 
											src={`/resources/audio?objectKey=${encodeURIComponent(track.audioFile.objectKey)}`} 
											type={track.audioFile.mimeType || 'audio/mpeg'} 
										/>
										Your browser does not support the audio element.
									</audio>
								</div>
							</div>
						)}
			</div>
		</div>
	)
}
