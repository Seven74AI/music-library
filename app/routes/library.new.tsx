// @context7: @conform-to/zod, @paralleldrive/cuid2, Fly.io, Prisma, React Router, Zod
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - @conform-to/zod
    - @paralleldrive/cuid2
    - Fly.io
    - Prisma
    - React Router
    - Zod
    - resolve-library-id: @conform-to/zod
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: @paralleldrive/cuid2
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Fly.io
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Zod
    - get-library-docs: [resolved-id] (focus: general usage)

    Context7 Instructions:
    - resolve-library-id: @conform-to/zod
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: @paralleldrive/cuid2
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Fly.io
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Zod
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
import { parseWithZod } from '@conform-to/zod'
import { createId } from '@paralleldrive/cuid2'
import { data, Form, useNavigation, Link } from 'react-router'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { uploadTrackAudio } from '#app/utils/storage.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/library.new.ts'

const MAX_AUDIO_SIZE = 50 * 1024 * 1024 // 50MB

const TrackFormSchema = z.object({
	title: z.string().min(1, 'Title is required').max(100, 'Title must be less than 100 characters'),
	artist: z.string().min(1, 'Artist is required').max(100, 'Artist must be less than 100 characters'),
	audioFile: z
		.instanceof(File)
		.refine((file) => file.size > 0, 'Audio file is required')
		.refine(
			(file) => file.size <= MAX_AUDIO_SIZE,
			'Audio file must be less than 50MB',
		)
		.refine(
			(file) => file.type.startsWith('audio/'),
			'File must be an audio file',
		),
})

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return data({})
}

export async function action({ request }: Route.ActionArgs) {
	await requireUserId(request)
	
	try {
		const formData = await request.formData()
		const submission = await parseWithZod(formData, {
			schema: TrackFormSchema.transform(async (data) => {
				const trackId = createId()
				return {
					...data,
					id: trackId,
					audioFile: {
						objectKey: await uploadTrackAudio(trackId, data.audioFile),
						fileName: data.audioFile.name,
						fileSize: data.audioFile.size,
						mimeType: data.audioFile.type,
					},
				}
			}),
			async: true,
		})

		if (submission.status !== 'success') {
			return data(
				{ result: submission.reply() },
				{ status: submission.status === 'error' ? 400 : 200 },
			)
		}

		const { id: trackId, title, artist, audioFile } = submission.value

		await prisma.track.create({
			data: {
				id: trackId,
				title,
				artist,
				audioFile: {
					create: audioFile,
				},
			},
		})

		return redirectWithToast(`/library/${trackId}`, {
			title: 'Track Added!',
			description: `"${title}" by ${artist} has been added to your library.`,
			type: 'success',
		})
	} catch (error) {
		console.error('Error creating track:', error)
		
		return data(
			{ 
				result: {
					error: {
						message: 'Failed to create track. Please try again.',
					}
				}
			},
			{ status: 500 },
		)
	}
}

export default function NewTrackRoute({
	actionData,
}: Route.ComponentProps) {
	const navigation = useNavigation()
	const isSubmitting = navigation.formAction === '/library/new'

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Icon name="plus" className="text-muted-foreground" />
					<h2 className="text-h2">Add New Track</h2>
				</div>
				<Button asChild variant="outline">
					<Link to="/library">
						<Icon name="arrow-left" className="mr-2" />
						Back to Library
					</Link>
				</Button>
			</div>
					<Form method="post" encType="multipart/form-data" className="flex-1">
						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-2">
								<Label htmlFor="title">Title</Label>
								<Input
									id="title"
									name="title"
									type="text"
									placeholder="Enter track title"
									required
									maxLength={100}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="artist">Artist</Label>
								<Input
									id="artist"
									name="artist"
									type="text"
									placeholder="Enter artist name"
									required
									maxLength={100}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="audioFile">Audio File</Label>
								<Input
									id="audioFile"
									name="audioFile"
									type="file"
									accept="audio/*"
									required
								/>
								<p className="text-sm text-muted-foreground">
									Supported formats: MP3, WAV, M4A, etc. Max size: 50MB
								</p>
							</div>
							{actionData?.result?.error && (
								<div className="rounded-md bg-destructive/15 p-3">
									<p className="text-sm text-destructive">
										{actionData.result.error.message || 'Please check your input and try again.'}
									</p>
								</div>
							)}
							<div className="flex gap-4">
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? 'Adding...' : 'Add Track'}
								</Button>
							</div>
						</div>
			</Form>
		</div>
	)
}
