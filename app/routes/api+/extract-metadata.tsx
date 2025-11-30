// @context7: @mjackson/form-data-parser, React Router
import { parseFormData } from '@mjackson/form-data-parser'
import { data, type ActionFunctionArgs } from 'react-router'
import { extractAudioMetadata } from '#app/utils/audio-metadata.server'
import { requireUserId } from '#app/utils/auth.server'
import { extractAudioFilesFromZip } from '#app/utils/zip-extraction.server'

// Maximum file size: 100MB for single file, 500MB for ZIP
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_ZIP_SIZE = 500 * 1024 * 1024

// Allowed audio MIME types
const ALLOWED_AUDIO_MIME_TYPES = [
	'audio/mpeg',
	'audio/mp3',
	'audio/flac',
	'audio/wav',
	'audio/wave',
	'audio/mp4',
	'audio/m4a',
	'audio/aac',
	'audio/ogg',
	'audio/webm',
]

// Allowed ZIP MIME types
const ALLOWED_ZIP_MIME_TYPES = [
	'application/zip',
	'application/x-zip-compressed',
	'application/x-zip',
]

export async function action({ request }: ActionFunctionArgs) {
	await requireUserId(request)

	// Parse form data with file size limit
	const formData = await parseFormData(request, { maxFileSize: MAX_ZIP_SIZE })

	// Get file(s) from form data
	const fileInput = formData.get('file')
	const filesInput = formData.getAll('files')

	// Determine if we have a single file, multiple files, or ZIP
	let filesToProcess: File[] = []

	if (fileInput instanceof File) {
		// Single file or ZIP
		if (ALLOWED_ZIP_MIME_TYPES.includes(fileInput.type) || fileInput.name.toLowerCase().endsWith('.zip')) {
			// It's a ZIP file
			if (fileInput.size > MAX_ZIP_SIZE) {
				return data(
					{
						success: false,
						error: `ZIP file size exceeds maximum of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
					},
					{ status: 400 }
				)
			}

			try {
				// Extract ZIP
				const arrayBuffer = await fileInput.arrayBuffer()
				const zipBuffer = Buffer.from(arrayBuffer)
				const extractedFiles = await extractAudioFilesFromZip(zipBuffer)

				// Convert extracted files to File-like objects for processing
				// We'll process them as buffers directly
				const results = []
				for (const extractedFile of extractedFiles) {
					try {
						const metadata = await extractAudioMetadata(
							extractedFile.buffer,
							extractedFile.fileName
						)
						results.push({
							fileName: extractedFile.fileName,
							metadata,
						})
					} catch (error) {
						console.error(`Error extracting metadata from ${extractedFile.fileName}:`, error)
						// Continue with other files even if one fails
						results.push({
							fileName: extractedFile.fileName,
							metadata: null,
							error: error instanceof Error ? error.message : 'Failed to extract metadata',
						})
					}
				}

				return data(
					{
						success: true,
						files: results,
					},
					{ status: 200 }
				)
			} catch (error) {
				return data(
					{
						success: false,
						error: `Failed to extract ZIP file: ${error instanceof Error ? error.message : 'Unknown error'}`,
					},
					{ status: 400 }
				)
			}
		} else {
			// Single audio file
			filesToProcess = [fileInput]
		}
	} else if (filesInput.length > 0 && filesInput.every(f => f instanceof File)) {
		// Multiple files
		filesToProcess = filesInput as File[]
	} else {
		return data(
			{
				success: false,
				error: 'No file or files provided',
			},
			{ status: 400 }
		)
	}

	// Validate audio files
	for (const file of filesToProcess) {
		if (file.size === 0) {
			return data(
				{
					success: false,
					error: `File ${file.name} is empty`,
				},
				{ status: 400 }
			)
		}

		if (file.size > MAX_FILE_SIZE) {
			return data(
				{
					success: false,
					error: `File ${file.name} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
				},
				{ status: 400 }
			)

		}

		if (!ALLOWED_AUDIO_MIME_TYPES.includes(file.type)) {
			return data(
				{
					success: false,
					error: `File ${file.name} has invalid MIME type: ${file.type}. Allowed types: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}`,
				},
				{ status: 400 }
			)
		}
	}

	// Extract metadata from each file
	const results = []
	for (const file of filesToProcess) {
		try {
			const arrayBuffer = await file.arrayBuffer()
			const buffer = Buffer.from(arrayBuffer)
			const metadata = await extractAudioMetadata(buffer, file.name)

			results.push({
				fileName: file.name,
				metadata,
			})
		} catch (error) {
			// Enhanced error logging for debugging
			console.error(`Error extracting metadata from ${file.name}:`, {
				fileName: file.name,
				fileSize: file.size,
				fileType: file.type,
				error: error instanceof Error ? {
					message: error.message,
					stack: error.stack,
					name: error.name,
				} : error,
			})
			// Continue with other files even if one fails
			results.push({
				fileName: file.name,
				metadata: null,
				error: error instanceof Error ? error.message : 'Failed to extract metadata',
			})
		}
	}

	return data(
		{
			success: true,
			files: results,
		},
		{ status: 200 }
	)
}

