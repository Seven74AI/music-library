// @context7: React Router, File Upload, Server-Sent Events
import { useState, useRef, useEffect, useCallback } from 'react'
import { data, Link, useActionData, useNavigate, isRouteErrorResponse, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs'
import { GeneralErrorBoundary } from '#app/components/error-boundary'
import { MetadataEditor } from '#app/components/metadata-editor'
import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { UploadCompletion } from '#app/components/upload-completion'
import { LOCAL_SERVICE } from '#app/constants/services'
import { type ExtractedAudioMetadata } from '#app/utils/audio-metadata.server'
import { prisma } from '#app/utils/db.server'
import { requireUserWithRole } from '#app/utils/permissions.server'

export const handle: BreadcrumbHandle = {
	breadcrumb: <Icon name="download">Upload</Icon>,
}

type UploadStep = 'select' | 'extracting' | 'edit' | 'confirm' | 'uploading' | 'completed'

interface FileWithMetadata {
	file: File
	fileName: string
	extractedMetadata: ExtractedAudioMetadata | null
	editedMetadata: {
		title?: string
		artist?: string
		album?: string
		genre?: string
		year?: number
		trackNumber?: number
		albumArtist?: string
		bpm?: number
		label?: string
		isrc?: string
		originalDate?: string
		originalYear?: number
		releaseDate?: string
		totalTracks?: number
		totalDiscs?: number
		lyrics?: string
	}
	error?: string
}

export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserWithRole(request, 'admin')
	
	const service = await prisma.service.findUnique({
		where: { name: LOCAL_SERVICE.NAME }
	})
	
	if (!service) {
		throw new Response('Local service not found', { status: 404 })
	}
	
	return data({ service })
}

export async function action({ request }: ActionFunctionArgs) {
	await requireUserWithRole(request, 'admin')
	// This action is kept for backward compatibility but won't be used in the new workflow
	// The new workflow uses the batch upload API directly
	return data({ error: 'Please use the new upload workflow' }, { status: 400 })
}

export default function LocalUploadPage() {
	const actionData = useActionData<typeof action>()
	const navigate = useNavigate()
	
	const [step, setStep] = useState<UploadStep>('select')
	const [selectedFiles, setSelectedFiles] = useState<File[]>([])
	const [filesWithMetadata, setFilesWithMetadata] = useState<FileWithMetadata[]>([])
	const [isDragging, setIsDragging] = useState(false)
	const [uploadId, setUploadId] = useState<string | null>(null)
	const [browserUploadProgress, setBrowserUploadProgress] = useState(0)
	const [uploadPhase, setUploadPhase] = useState<'uploading-to-server' | 'server-processing' | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const dropZoneRef = useRef<HTMLDivElement>(null)

	// Handle drag and drop
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}, [])

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)

		const files = Array.from(e.dataTransfer.files).filter(file => {
			const isAudio = file.type.startsWith('audio/')
			const isZip = file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')
			return isAudio || isZip
		})

		if (files.length > 0) {
			setSelectedFiles(files)
		}
	}, [])

	// Handle file input change
	const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files || [])
		if (files.length > 0) {
			setSelectedFiles(files)
		}
	}

	// Extract metadata from selected files
	const extractMetadata = useCallback(async () => {
		if (selectedFiles.length === 0) return

		setStep('extracting')

		try {
			const formData = new FormData()
			
			// Check if we have a ZIP file
			const zipFile = selectedFiles.find(f => 
				f.type === 'application/zip' || 
				f.type === 'application/x-zip-compressed' ||
				f.name.toLowerCase().endsWith('.zip')
			)

			if (zipFile) {
				formData.append('file', zipFile)
			} else {
				// Multiple audio files
				selectedFiles.forEach(file => {
					formData.append('files', file)
				})
			}

			const response = await fetch('/api/extract-metadata', {
		method: 'POST',
				body: formData,
			})

			const result = await response.json() as {
				success: boolean
				files?: Array<{
					fileName: string
					metadata: ExtractedAudioMetadata | null
					error?: string
				}>
				error?: string
			}
	
	if (!response.ok || !result.success) {
				throw new Error(result.error || 'Failed to extract metadata')
			}

			// Map extracted metadata to files
			const filesWithMeta: FileWithMetadata[] = result.files?.map((item, index) => {
				// Find the corresponding File object
				const file = selectedFiles[index] || selectedFiles.find(f => f.name === item.fileName)
				
				return {
					file: file || new File([], item.fileName),
					fileName: item.fileName,
					extractedMetadata: item.metadata,
					editedMetadata: item.metadata ? {
						title: item.metadata.title,
						artist: item.metadata.artist,
						album: item.metadata.album,
						genre: item.metadata.genre?.[0],
						year: item.metadata.year,
						trackNumber: item.metadata.track?.no,
						albumArtist: item.metadata.albumArtist,
						bpm: item.metadata.bpm,
						label: item.metadata.label,
						isrc: item.metadata.isrc,
						originalDate: item.metadata.originalDate,
						originalYear: item.metadata.originalYear,
						releaseDate: item.metadata.releaseDate,
						totalTracks: item.metadata.totalTracks,
						totalDiscs: item.metadata.totalDiscs,
						lyrics: item.metadata.lyrics,
					} : {},
					error: item.error,
				}
			}) || []

			setFilesWithMetadata(filesWithMeta)
			setStep('edit')
		} catch (error) {
			console.error('Error extracting metadata:', error)
			// Show error but allow user to continue
			setFilesWithMetadata(selectedFiles.map(file => ({
				file,
				fileName: file.name,
				extractedMetadata: null,
				editedMetadata: {},
				error: error instanceof Error ? error.message : 'Failed to extract metadata',
			})))
			setStep('edit')
		}
	}, [selectedFiles])

	// Auto-extract metadata when files are selected and step is 'select'
	useEffect(() => {
		if (selectedFiles.length > 0 && step === 'select') {
			void extractMetadata()
		}
	}, [selectedFiles, step, extractMetadata])

	// Memoize upload completion handler to prevent EventSource reconnection
	const handleUploadComplete = useCallback(() => {
		setStep('completed')
	}, [])

	// Handle metadata edit
	const updateFileMetadata = (index: number, updates: Partial<FileWithMetadata['editedMetadata']>) => {
		setFilesWithMetadata(prev => prev.map((file, i) => 
			i === index ? { ...file, editedMetadata: { ...file.editedMetadata, ...updates } } : file
		))
	}

	// Handle bulk metadata edit
	const applyBulkMetadata = (updates: Partial<FileWithMetadata['editedMetadata']>) => {
		setFilesWithMetadata(prev => prev.map(file => ({
			...file,
			editedMetadata: { ...file.editedMetadata, ...updates }
		})))
	}

	// Start upload
	const startUpload = async () => {
		setStep('uploading')
		setUploadPhase('uploading-to-server')
		setBrowserUploadProgress(0)

		try {
			const formData = new FormData()

			// Check if we have a ZIP file
			const zipFile = selectedFiles.find(f => 
				f.type === 'application/zip' || 
				f.type === 'application/x-zip-compressed' ||
				f.name.toLowerCase().endsWith('.zip')
			)

			if (zipFile) {
				formData.append('zipFile', zipFile)
			} else {
				// Multiple audio files
				selectedFiles.forEach(file => {
					formData.append('files', file)
				})
			}

			// Add metadata for each file
			filesWithMetadata.forEach((fileWithMeta, index) => {
				formData.append(`metadata[${index}]`, JSON.stringify(fileWithMeta.editedMetadata))
			})

			// Use XMLHttpRequest to track upload progress
			const result = await new Promise<{
				success: boolean
				uploadId?: string
				error?: string
			}>((resolve, reject) => {
				const xhr = new XMLHttpRequest()

				// Track upload progress (browser → server)
				xhr.upload.addEventListener('progress', (e) => {
					if (e.lengthComputable) {
						const percentComplete = Math.round((e.loaded / e.total) * 100)
						setBrowserUploadProgress(percentComplete)
					}
				})

				xhr.addEventListener('load', () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						try {
							const result = JSON.parse(xhr.responseText) as {
								success: boolean
								uploadId?: string
								error?: string
							}

							if (!result.success) {
								reject(new Error(result.error || 'Failed to start upload'))
								return
							}

							resolve(result)
						} catch (error) {
							reject(error)
						}
					} else {
						reject(new Error(`Upload failed with status ${xhr.status}`))
					}
				})

				xhr.addEventListener('error', () => {
					reject(new Error('Upload failed'))
				})

				xhr.addEventListener('abort', () => {
					reject(new Error('Upload aborted'))
				})

				xhr.open('POST', '/api/upload-audio-batch')
				xhr.send(formData)
			})

			// Browser upload complete, transition to server processing phase
			// Set uploadId first, then phase, to ensure smooth transition
			if (result.uploadId) {
				setUploadId(result.uploadId)
			}
			// Transition to server processing phase immediately after upload completes
			setUploadPhase('server-processing')
			// Keep progress at 100% briefly, then it will be replaced by SSE progress
		} catch (error) {
			console.error('Error starting upload:', error)
			setUploadPhase(null)
			setBrowserUploadProgress(0)
			// Show error - you may want to add error state handling here
		}
	}

	// Handle retry failed uploads
	const handleRetryFailed = () => {
		// Reset to upload step - the retry will need to be implemented with stored file data
		// For now, just reset to allow manual retry
		setStep('select')
		setSelectedFiles([])
		setFilesWithMetadata([])
		setUploadId(null)
	}

	// Handle upload more
	const handleUploadMore = () => {
		setSelectedFiles([])
		setFilesWithMetadata([])
		setUploadId(null)
		setStep('select')
	}

	// Handle view library
	const handleViewLibrary = () => {
		void navigate('/library')
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
				<h1 className="text-3xl font-bold">Upload Audio Files</h1>
				<p className="text-muted-foreground mt-2">
					Upload audio files or ZIP archives from your computer to add them to your library
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
			
			{/* Step 1: File Selection */}
			{step === 'select' && (
			<Card>
				<CardHeader>
						<CardTitle>Select Files</CardTitle>
					<CardDescription>
							Drag and drop audio files or ZIP archives, or click to browse
					</CardDescription>
				</CardHeader>
				<CardContent>
						<div
							ref={dropZoneRef}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
								isDragging
									? 'border-primary bg-primary/5'
									: 'border-muted-foreground/25 hover:border-muted-foreground/50'
							}`}
						>
							<Icon name="download" className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
							<p className="text-lg font-medium mb-2">
								{isDragging ? 'Drop files here' : 'Drag and drop files here'}
							</p>
							<p className="text-sm text-muted-foreground mb-4">
								or
							</p>
							<Button
								type="button"
								variant="outline"
								onClick={() => fileInputRef.current?.click()}
							>
								<Icon name="file-text" className="mr-2" />
								Browse Files
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								accept="audio/*,.zip"
								onChange={handleFileInputChange}
								className="hidden"
							/>
							<p className="text-xs text-muted-foreground mt-4">
								Supported: MP3, FLAC, WAV, M4A, AAC, OGG, ZIP (Max 100MB per file, 500MB for ZIP)
							</p>
						</div>

						{selectedFiles.length > 0 && (
							<div className="mt-6 space-y-2">
								<p className="text-sm font-medium">Selected files ({selectedFiles.length}):</p>
								<div className="space-y-1 max-h-48 overflow-y-auto">
									{selectedFiles.map((file, index) => (
										<div key={index} className="text-sm text-muted-foreground">
											• {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
										</div>
									))}
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{/* Step 2: Extracting Metadata */}
			{step === 'extracting' && (
				<Card>
					<CardHeader>
						<CardTitle>Extracting Metadata</CardTitle>
						<CardDescription>
							Please wait while we extract metadata from your files...
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<Icon name="arrow-path" className="h-12 w-12 animate-spin mb-4 text-primary" />
						<p className="text-muted-foreground">Processing {selectedFiles.length} file(s)...</p>
				</CardContent>
			</Card>
			)}

			{/* Step 3: Edit Metadata */}
			{step === 'edit' && filesWithMetadata.length > 0 && (
				<MetadataEditor
					files={filesWithMetadata.map(f => ({
						fileName: f.fileName,
						extractedMetadata: f.extractedMetadata ? {
							...f.extractedMetadata,
							genre: Array.isArray(f.extractedMetadata.genre) ? f.extractedMetadata.genre[0] : f.extractedMetadata.genre,
						} : null,
						editedMetadata: f.editedMetadata,
						error: f.error,
					}))}
					onUpdate={updateFileMetadata}
					onBulkUpdate={applyBulkMetadata}
					onConfirm={() => setStep('confirm')}
					onCancel={() => {
						setSelectedFiles([])
						setFilesWithMetadata([])
						setStep('select')
					}}
				/>
			)}

			{/* Step 4: Confirmation */}
			{step === 'confirm' && (
				<ConfirmationStep
					files={filesWithMetadata}
					onConfirm={startUpload}
					onBack={() => setStep('edit')}
				/>
			)}

			{/* Step 5: Uploading with Progress */}
			{/* Phase 1: Browser → Server Upload */}
			{step === 'uploading' && uploadPhase === 'uploading-to-server' && (
				<Card>
					<CardHeader>
						<CardTitle>Uploading Files</CardTitle>
						<CardDescription>
							Uploading to server...
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<div>
								<div className="flex justify-between mb-2">
									<span className="text-sm font-medium">Upload Progress</span>
									<span className="text-sm text-muted-foreground">{browserUploadProgress}%</span>
								</div>
								<div className="w-full bg-muted rounded-full h-2">
									<div
										className="bg-primary h-2 rounded-full transition-all"
										style={{ width: `${browserUploadProgress}%` }}
									/>
								</div>
							</div>
							<p className="text-sm text-muted-foreground">
								Please wait while your files are being uploaded to the server...
							</p>
						</div>
					</CardContent>
				</Card>
			)}
			{/* Phase 2 & 3: Server Processing (Metadata Extraction + Storage Upload) */}
			{step === 'uploading' && uploadPhase === 'server-processing' && uploadId && (
				<UploadProgressStep 
					uploadId={uploadId}
					onComplete={handleUploadComplete}
				/>
			)}

			{/* Step 6: Completion Screen */}
			{step === 'completed' && uploadId && (
				<CompletionStep 
					uploadId={uploadId}
					onRetryFailed={handleRetryFailed}
					onUploadMore={handleUploadMore}
					onViewLibrary={handleViewLibrary}
				/>
			)}
		</div>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				403: ({ error }) => (
					<div className="flex flex-col items-center justify-center gap-4 p-8">
						<Icon name="lock-closed" className="h-12 w-12 text-destructive" />
						<h1 className="text-2xl font-bold">Access Denied</h1>
						<p className="text-muted-foreground">
							{isRouteErrorResponse(error) && error.data?.message
								? error.data.message
								: 'You do not have permission to access this page. Admin access is required.'}
						</p>
						<Button asChild>
							<Link to="/music/services">
								<Icon name="arrow-left" className="mr-2" />
								Back to Services
							</Link>
						</Button>
					</div>
				),
			}}
		/>
	)
}


// Confirmation Step Component
function ConfirmationStep({
	files,
	onConfirm,
	onBack,
}: {
	files: FileWithMetadata[]
	onConfirm: () => void
	onBack: () => void
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Confirm Upload</CardTitle>
				<CardDescription>
					Review all files and metadata before uploading
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{files.map((file, index) => (
						<div key={index} className="border rounded-lg p-4">
							<p className="font-medium">{file.editedMetadata.title || file.fileName}</p>
							<p className="text-sm text-muted-foreground">
								{file.editedMetadata.artist || 'Unknown Artist'}
							</p>
						</div>
					))}
				</div>
				<div className="flex gap-4 mt-6">
					<Button onClick={onConfirm}>Start Upload</Button>
					<Button variant="outline" onClick={onBack}>Back to Edit</Button>
				</div>
			</CardContent>
		</Card>
	)
}

// Upload Progress Step Component (will use SSE)
function UploadProgressStep({ 
	uploadId,
	onComplete,
}: { 
	uploadId: string
	onComplete: () => void
}) {
	const onCompleteStable = useCallback(() => {
		onComplete()
	}, [onComplete])
	
	const [progress, setProgress] = useState<{
		files: Array<{
			fileId: string
			fileName: string
			progress: number
			status: string
			error?: string
		}>
		overallProgress: number
		status: string
		uploadSpeed?: number // bytes per second
		successfulTracks?: Array<{
			trackId: string
			fileName: string
			title: string
			artist: string
		}>
		failedFiles?: Array<{
			fileId: string
			fileName: string
			error: string
		}>
	} | null>(null)

	useEffect(() => {
		const eventSource = new EventSource(`/api/upload-progress/${uploadId}`)

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as {
					type?: string
					files?: Array<{
						fileId: string
						fileName: string
						progress: number
						status: string
						error?: string
					}>
					overallProgress?: number
					status?: string
					uploadSpeed?: number
					successfulTracks?: Array<{
						trackId: string
						fileName: string
						title: string
						artist: string
					}>
					failedFiles?: Array<{
						fileId: string
						fileName: string
						error: string
					}>
				}
				if (data.type === 'progress' || (data.files && data.overallProgress !== undefined)) {
					const newProgress = {
						files: data.files || [],
						overallProgress: data.overallProgress || 0,
						status: data.status || 'in-progress',
						uploadSpeed: data.uploadSpeed,
						successfulTracks: data.successfulTracks || [],
						failedFiles: data.failedFiles || [],
					}
					setProgress(newProgress)
					
					// Check if upload is completed
					if (newProgress.status === 'completed' || newProgress.status === 'failed') {
						// Wait a bit for final progress update, then show completion
						setTimeout(() => {
							onCompleteStable()
						}, 1000)
					}
				}
			} catch (error) {
				console.error('Error parsing SSE data:', error)
			}
		}

		eventSource.onerror = () => {
			eventSource.close()
		}

		return () => {
			eventSource.close()
		}
	}, [uploadId, onCompleteStable])

	return (
		<Card>
			<CardHeader>
				<CardTitle>Uploading Files</CardTitle>
				<CardDescription>
					{progress && progress.files.some(f => f.status === 'processing') 
						? 'Extracting metadata from files...' 
						: progress && progress.files.some(f => f.status === 'uploading')
						? 'Uploading files to storage...'
						: 'Upload progress will appear here'}
			</CardDescription>
			</CardHeader>
			<CardContent>
				{progress && (
					<div className="space-y-4">
						<div>
							<div className="flex justify-between mb-2">
								<span className="text-sm font-medium">Overall Progress</span>
								<div className="flex items-center gap-2">
									{progress.files.some(f => f.status === 'processing') && (
										<span className="text-xs text-muted-foreground animate-pulse">
											Extracting metadata...
										</span>
									)}
									{progress.uploadSpeed !== undefined && progress.uploadSpeed > 0 && (
										<span className="text-xs text-muted-foreground">
											{progress.uploadSpeed > 1024 * 1024
												? `${(progress.uploadSpeed / (1024 * 1024)).toFixed(2)} MB/s`
												: `${(progress.uploadSpeed / 1024).toFixed(2)} KB/s`}
										</span>
									)}
									<span className="text-sm text-muted-foreground">{progress.overallProgress}%</span>
								</div>
							</div>
							<div className="w-full bg-muted rounded-full h-2">
								<div
									className={`h-2 rounded-full transition-all ${
										progress.files.some(f => f.status === 'processing') ? 'bg-yellow-500' :
										progress.files.some(f => f.status === 'failed') ? 'bg-destructive' :
										progress.files.every(f => f.status === 'completed') ? 'bg-green-500' :
										'bg-primary'
									}`}
									style={{ width: `${progress.overallProgress}%` }}
								/>
							</div>
						</div>
						<div className="space-y-2">
							{progress.files.map((file) => (
								<div key={file.fileId}>
									<div className="flex justify-between mb-1">
										<span className="text-sm">{file.fileName}</span>
										<div className="flex items-center gap-2">
											{file.status === 'processing' && (
												<span className="text-xs text-muted-foreground animate-pulse">
													Extracting metadata...
												</span>
											)}
											{file.status === 'uploading' && (
												<span className="text-xs text-muted-foreground">
													Uploading...
												</span>
											)}
											{file.status === 'completed' && (
												<span className="text-xs text-green-600">
													Completed
												</span>
											)}
											{file.status === 'failed' && (
												<span className="text-xs text-destructive">
													Failed
												</span>
											)}
											<span className="text-sm text-muted-foreground">{file.progress}%</span>
										</div>
									</div>
									<div className="w-full bg-muted rounded-full h-1.5">
										<div
											className={`h-1.5 rounded-full transition-all ${
												file.status === 'completed' ? 'bg-green-500' :
												file.status === 'failed' ? 'bg-destructive' :
												file.status === 'processing' ? 'bg-yellow-500' :
												'bg-primary'
											}`}
											style={{ width: `${file.progress}%` }}
										/>
									</div>
									{file.error && (
										<p className="text-xs text-destructive mt-1">{file.error}</p>
									)}
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

// Completion Step Component
function CompletionStep({
	uploadId,
	onRetryFailed,
	onUploadMore,
	onViewLibrary,
}: {
	uploadId: string
	onRetryFailed: () => void
	onUploadMore: () => void
	onViewLibrary: () => void
}) {
	const [completionData, setCompletionData] = useState<{
		successfulTracks: Array<{
			trackId: string
			fileName: string
			title: string
			artist: string
		}>
		failedFiles: Array<{
			fileId: string
			fileName: string
			error: string
		}>
	} | null>(null)

	useEffect(() => {
		// Fetch final progress data by connecting to SSE briefly
		let eventSource: EventSource | null = null
		let timeoutId: ReturnType<typeof setTimeout> | null = null
		
		const fetchCompletionData = () => {
			try {
				eventSource = new EventSource(`/api/upload-progress/${uploadId}`)
				
				eventSource.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data) as {
							type?: string
							successfulTracks?: Array<{
								trackId: string
								fileName: string
								title: string
								artist: string
							}>
							failedFiles?: Array<{
								fileId: string
								fileName: string
								error: string
							}>
							status?: string
						}
						
						if (data.type === 'progress') {
							if (data.status === 'completed' || data.status === 'failed') {
								setCompletionData({
									successfulTracks: data.successfulTracks || [],
									failedFiles: data.failedFiles || [],
								})
								if (eventSource) {
									eventSource.close()
								}
								// Clear timeout if completion happens before timeout
								if (timeoutId) {
									clearTimeout(timeoutId)
									timeoutId = null
								}
							}
						}
					} catch (error) {
						console.error('Error parsing completion data:', error)
					}
				}

				eventSource.onerror = () => {
					if (eventSource) {
						eventSource.close()
					}
					// Clear timeout on error
					if (timeoutId) {
						clearTimeout(timeoutId)
						timeoutId = null
					}
				}

				// Cleanup after 10 seconds
				timeoutId = setTimeout(() => {
					if (eventSource) {
						eventSource.close()
					}
					timeoutId = null
				}, 10000)
			} catch (error) {
				console.error('Error fetching completion data:', error)
			}
		}

		fetchCompletionData()

		return () => {
			if (eventSource) {
				eventSource.close()
			}
			// Clear timeout to prevent memory leak
			if (timeoutId) {
				clearTimeout(timeoutId)
				timeoutId = null
			}
		}
	}, [uploadId])

	if (!completionData) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Processing...</CardTitle>
					<CardDescription>Gathering upload results...</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<Icon name="arrow-path" className="h-8 w-8 animate-spin text-primary" />
					</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<UploadCompletion
			successfulTracks={completionData.successfulTracks}
			failedFiles={completionData.failedFiles}
			onRetryFailed={onRetryFailed}
			onUploadMore={onUploadMore}
			onViewLibrary={onViewLibrary}
		/>
	)
}
