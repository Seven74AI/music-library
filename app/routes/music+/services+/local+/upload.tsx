// @context7: React Router, Form, File Upload
import { useState } from 'react'
import { data, Form, Link, useActionData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs'
import { Field } from '#app/components/forms'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { LOCAL_SERVICE } from '#app/constants/services'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { redirectWithToast } from '#app/utils/toast.server'

export const handle: BreadcrumbHandle = {
	breadcrumb: <Icon name="download">Upload</Icon>,
}

export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserId(request)
	
	const service = await prisma.service.findUnique({
		where: { name: LOCAL_SERVICE.NAME }
	})
	
	if (!service) {
		throw new Response('Local service not found', { status: 404 })
	}
	
	return data({ service })
}

export async function action({ request }: ActionFunctionArgs) {
	await requireUserId(request)
	const formData = await request.formData()
	
	const audioFile = formData.get('audioFile')
	const title = formData.get('title')?.toString()
	const artist = formData.get('artist')?.toString()
	const album = formData.get('album')?.toString()
	
	if (!(audioFile instanceof File) || audioFile.size === 0) {
		return data(
			{ error: 'Please select an audio file to upload' },
			{ status: 400 }
		)
	}
	
	// Create FormData for API call
	const uploadFormData = new FormData()
	uploadFormData.append('audioFile', audioFile)
	if (title) uploadFormData.append('title', title)
	if (artist) uploadFormData.append('artist', artist)
	if (album) uploadFormData.append('album', album)
	
	// Call upload API
	const response = await fetch('/api/upload-audio', {
		method: 'POST',
		body: uploadFormData,
	})
	
	const result = await response.json() as { success?: boolean; error?: string; track?: { title: string; artist: string } }
	
	if (!response.ok || !result.success) {
		return data(
			{ error: result.error || 'Failed to upload audio file' },
			{ status: response.status }
		)
	}
	
	if (!result.track) {
		return data(
			{ error: 'Upload successful but track information is missing' },
			{ status: 500 }
		)
	}
	
	return redirectWithToast('/library', {
		title: 'Upload Successful',
		description: `"${result.track.title}" by ${result.track.artist} has been added to your library`,
		type: 'success',
	})
}

export default function LocalUploadPage() {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [previewMetadata, setPreviewMetadata] = useState<{
		title?: string
		artist?: string
		album?: string
	} | null>(null)
	
	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		
		setSelectedFile(file)
		
		// Try to extract basic info from filename
		const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
		// Common pattern: "Artist - Title" or "Title - Artist"
		const parts = nameWithoutExt.split(' - ')
		if (parts.length === 2) {
			setPreviewMetadata({
				artist: parts[0]?.trim() || undefined,
				title: parts[1]?.trim() || undefined,
			})
		} else {
			setPreviewMetadata({
				title: nameWithoutExt || undefined,
			})
		}
	}
	
	return (
		<div className="py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<Link to="/music/services">
							<Icon name="arrow-left" className="mr-2" />
							Back
						</Link>
					</Button>
				</div>
				<h1 className="text-3xl font-bold">Upload Audio File</h1>
				<p className="text-muted-foreground mt-2">
					Upload audio files from your computer to add them to your library
				</p>
			</div>
			
			{actionData?.error && (
				<div className="mb-6 rounded-md bg-destructive/15 p-4">
					<div className="flex items-center gap-2">
						<Icon name="question-mark-circled" className="h-4 w-4 text-destructive" />
						<p className="text-sm text-destructive font-medium">Error</p>
					</div>
					<p className="text-sm text-destructive mt-1">{actionData.error}</p>
				</div>
			)}
			
			<Card>
				<CardHeader>
					<CardTitle>Upload Audio File</CardTitle>
					<CardDescription>
						Supported formats: MP3, FLAC, WAV, M4A, AAC, OGG (Max 100MB)
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Form method="post" encType="multipart/form-data" className="space-y-6">
						<Field
							labelProps={{ htmlFor: 'audioFile', children: 'Audio File' }}
							inputProps={{
								id: 'audioFile',
								name: 'audioFile',
								type: 'file',
								accept: 'audio/*',
								required: true,
								onChange: handleFileChange,
							}}
							errors={[]}
						/>
						
						{selectedFile && (
							<div className="rounded-md bg-muted p-4">
								<p className="text-sm font-medium">Selected: {selectedFile.name}</p>
								<p className="text-xs text-muted-foreground mt-1">
									Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
								</p>
							</div>
						)}
						
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<Field
								labelProps={{ htmlFor: 'title', children: 'Title' }}
								inputProps={{
									id: 'title',
									name: 'title',
									type: 'text',
									placeholder: previewMetadata?.title || 'Track title',
									defaultValue: previewMetadata?.title || '',
								}}
								errors={[]}
							/>
							
							<Field
								labelProps={{ htmlFor: 'artist', children: 'Artist' }}
								inputProps={{
									id: 'artist',
									name: 'artist',
									type: 'text',
									placeholder: previewMetadata?.artist || 'Artist name',
									defaultValue: previewMetadata?.artist || '',
								}}
								errors={[]}
							/>
						</div>
						
						<Field
							labelProps={{ htmlFor: 'album', children: 'Album (Optional)' }}
							inputProps={{
								id: 'album',
								name: 'album',
								type: 'text',
								placeholder: previewMetadata?.album || 'Album name',
								defaultValue: previewMetadata?.album || '',
							}}
							errors={[]}
						/>
						
						<div className="flex gap-4">
							<Button
								type="submit"
								disabled={isSubmitting || !selectedFile}
							>
								{isSubmitting ? (
									<>
										<Icon name="update" className="mr-2 animate-spin" />
										Uploading...
									</>
								) : (
									<>
										<Icon name="download" className="mr-2" />
										Upload
									</>
								)}
							</Button>
							<Button asChild type="button" variant="outline">
								<Link to="/music/services">Cancel</Link>
							</Button>
						</div>
					</Form>
				</CardContent>
			</Card>
		</div>
	)
}

