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
import { data, redirect, Form, Link, useActionData, useNavigation } from 'react-router'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getPlaylistTitle } from '#app/utils/breadcrumb-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/playlists.$playlistId.ts'

export const handle: BreadcrumbHandle = {
	breadcrumb: ({ data }) => getPlaylistTitle(data),
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const playlist = await prisma.userPlaylist.findFirst({
		where: { 
			id: params.playlistId,
			ownerId: userId,
		},
		select: {
			id: true,
			title: true,
			description: true,
			createdAt: true,
			updatedAt: true,
			tracks: {
				select: {
					id: true,
					position: true,
					track: {
						select: {
							id: true,
							title: true,
							artist: true,
							createdAt: true,
							audioFile: {
								select: {
									id: true,
									fileName: true,
									fileSize: true,
									mimeType: true,
								},
							},
						},
					},
				},
				orderBy: { position: 'asc' },
			},
		},
	})

	if (!playlist) {
		throw new Response('Playlist not found', { status: 404 })
	}

	return data({ playlist })
}

export async function action({ request, params }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'delete') {
		await prisma.userPlaylist.delete({
			where: { 
				id: params.playlistId,
				ownerId: userId,
			},
		})
		return redirect('/playlists')
	}

	if (intent === 'update') {
		const title = formData.get('title')
		const description = formData.get('description')

		if (typeof title !== 'string' || !title.trim()) {
			return data({ error: 'Title is required' }, { status: 400 })
		}

		if (typeof description !== 'string') {
			return data({ error: 'Description must be a string' }, { status: 400 })
		}

		await prisma.userPlaylist.update({
			where: { 
				id: params.playlistId,
				ownerId: userId,
			},
			data: {
				title: title.trim(),
				description: description.trim() || null,
			},
		})

		return redirect(`/playlists/${params.playlistId}`)
	}

	return data({ error: 'Invalid intent' }, { status: 400 })
}

export default function PlaylistRoute({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	const { playlist } = loaderData

	return (
		<div className="max-w-4xl mx-auto">
			<div className="mb-6">
				<div className="flex items-center gap-4 mb-4">
					<Link 
						to="/playlists"
						className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
					>
						<Icon name="arrow-left" className="h-4 w-4" />
						Back
					</Link>
				</div>
				
				<h1 className="text-2xl font-bold">{playlist.title}</h1>
				{playlist.description && (
					<p className="text-muted-foreground mt-2">{playlist.description}</p>
				)}
				<p className="text-sm text-muted-foreground mt-2">
					{playlist.tracks.length} track{playlist.tracks.length !== 1 ? 's' : ''} • 
					Created {new Date(playlist.createdAt).toLocaleDateString()}
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				{/* Edit Form */}
				<div className="space-y-6">
					<h2 className="text-lg font-semibold">Edit Playlist</h2>
					<Form method="post" className="space-y-4">
						<input type="hidden" name="intent" value="update" />
						
						<div className="space-y-2">
							<Label htmlFor="title">Title</Label>
							<Input
								id="title"
								name="title"
								type="text"
								defaultValue={playlist.title}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								name="description"
								defaultValue={playlist.description || ''}
								rows={3}
							/>
						</div>

						{actionData?.error && (
							<div className="text-sm text-destructive">
								{actionData.error}
							</div>
						)}

						<div className="flex gap-4">
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? 'Updating...' : 'Update Playlist'}
							</Button>
						</div>
					</Form>

					{/* Delete Form */}
					<div className="border-t pt-6">
						<h3 className="text-lg font-semibold text-destructive mb-4">Danger Zone</h3>
						<Form method="post">
							<input type="hidden" name="intent" value="delete" />
							<Button 
								type="submit" 
								variant="destructive" 
								disabled={isSubmitting}
								onClick={(e) => {
									if (!confirm('Are you sure you want to delete this playlist? This action cannot be undone.')) {
										e.preventDefault()
									}
								}}
							>
								{isSubmitting ? 'Deleting...' : 'Delete Playlist'}
							</Button>
						</Form>
					</div>
				</div>

				{/* Tracks List */}
				<div className="space-y-6">
					<h2 className="text-lg font-semibold">Tracks</h2>
					
					{playlist.tracks.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<Icon name="file-text" className="h-12 w-12 mx-auto mb-4" />
							<p>No tracks in this playlist yet.</p>
							<Link 
								to="/library"
								className="inline-flex items-center gap-2 text-primary hover:underline mt-2"
							>
								<Icon name="plus" className="h-4 w-4" />
								Add tracks from your library
							</Link>
						</div>
					) : (
						<div className="space-y-2">
							{playlist.tracks.map((playlistTrack, index) => (
								<div 
									key={playlistTrack.id}
									className="flex items-center gap-4 p-3 rounded-lg border bg-card"
								>
									<div className="text-sm text-muted-foreground w-8">
										{index + 1}
									</div>
									<div className="flex-1">
										<h3 className="font-medium">{playlistTrack.track.title}</h3>
										<p className="text-sm text-muted-foreground">
											{playlistTrack.track.artist}
										</p>
									</div>
									<Link 
										to={`/library/${playlistTrack.track.id}`}
										className="text-primary hover:underline text-sm"
									>
										View Track
									</Link>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
