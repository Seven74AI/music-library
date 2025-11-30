// @context7: React, React Router
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'

interface SuccessfulTrack {
	trackId: string
	fileName: string
	title: string
	artist: string
}

interface FailedFile {
	fileId: string
	fileName: string
	error: string
}

interface UploadCompletionProps {
	successfulTracks: SuccessfulTrack[]
	failedFiles: FailedFile[]
	onRetryFailed: () => void
	onUploadMore: () => void
	onViewLibrary: () => void
}

export function UploadCompletion({
	successfulTracks,
	failedFiles,
	onRetryFailed,
	onUploadMore,
	onViewLibrary,
}: UploadCompletionProps) {
	const hasSuccess = successfulTracks.length > 0
	const hasFailures = failedFiles.length > 0

	return (
		<div className="space-y-6">
			{/* Success Section */}
			{hasSuccess && (
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<Icon name="check-circled" className="h-5 w-5 text-green-500" />
							<CardTitle>Upload Successful</CardTitle>
						</div>
						<CardDescription>
							{successfulTracks.length} track{successfulTracks.length !== 1 ? 's' : ''} uploaded successfully
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2 max-h-96 overflow-y-auto">
							{successfulTracks.map((track) => (
								<div
									key={track.trackId}
									className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
								>
									<div className="flex-1 min-w-0">
										<Link
											to={`/library/${track.trackId}`}
											className="block hover:underline"
										>
											<p className="font-medium truncate">{track.title}</p>
											<p className="text-sm text-muted-foreground truncate">{track.artist}</p>
										</Link>
										<p className="text-xs text-muted-foreground mt-1 truncate">{track.fileName}</p>
									</div>
									<Icon name="check-circled" className="h-5 w-5 text-green-500 ml-4 flex-shrink-0" />
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Error Section */}
			{hasFailures && (
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<Icon name="question-mark-circled" className="h-5 w-5 text-destructive" />
							<CardTitle>Upload Errors</CardTitle>
						</div>
						<CardDescription>
							{failedFiles.length} file{failedFiles.length !== 1 ? 's' : ''} failed to upload
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{failedFiles.map((file) => (
								<div
									key={file.fileId}
									className="p-3 border border-destructive/50 rounded-lg bg-destructive/5"
								>
									<div className="flex items-start justify-between gap-4">
										<div className="flex-1 min-w-0">
											<p className="font-medium text-destructive truncate">{file.fileName}</p>
											<p className="text-sm text-muted-foreground mt-1">{file.error}</p>
										</div>
										<Icon name="question-mark-circled" className="h-5 w-5 text-destructive flex-shrink-0" />
									</div>
								</div>
							))}
						</div>
						<div className="mt-4">
							<Button onClick={onRetryFailed} variant="outline" className="w-full sm:w-auto">
								<Icon name="arrow-path" className="mr-2" />
								Retry Failed Uploads
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Action Buttons */}
			<div className="flex flex-col sm:flex-row gap-3">
				{hasSuccess && (
					<Button onClick={onViewLibrary} className="flex-1">
						<Icon name="arrow-left" className="mr-2" />
						View Library
					</Button>
				)}
				<Button onClick={onUploadMore} variant="outline" className="flex-1">
					<Icon name="plus" className="mr-2" />
					Upload More Files
				</Button>
			</div>
		</div>
	)
}




