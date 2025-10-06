import { useState, useEffect } from 'react'
import { Form, useNavigation } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#app/components/ui/dialog.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'

interface AddTrackModalProps {
	actionData?: {
		result?: {
			error?: {
				message?: string
			}
		}
	}
}

export function AddTrackModal({ actionData }: AddTrackModalProps) {
	const [open, setOpen] = useState(false)
	const [mounted, setMounted] = useState(false)
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'

	// Ensure component is mounted before showing modal to prevent hydration mismatch
	useEffect(() => {
		setMounted(true)
	}, [])

	const handleSuccess = () => {
		// Close modal on successful submission
		setOpen(false)
	}

	// Don't render the modal until mounted to prevent hydration mismatch
	if (!mounted) {
		return (
			<Button disabled>
				<Icon name="plus" className="mr-2 h-4 w-4" />
				Add Track
			</Button>
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<Icon name="plus" className="mr-2 h-4 w-4" />
					Add Track
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add New Track</DialogTitle>
					<DialogDescription>
						Upload an audio file to add it to your music library.
					</DialogDescription>
				</DialogHeader>
				
				<Form method="post" action="/library/new" encType="multipart/form-data" onSubmit={handleSuccess}>
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
					</div>
					
					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={isSubmitting}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? (
								<>
									<Icon name="update" className="mr-2 h-4 w-4 animate-spin" />
									Adding...
								</>
							) : (
								<>
									<Icon name="plus" className="mr-2 h-4 w-4" />
									Add Track
								</>
							)}
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
