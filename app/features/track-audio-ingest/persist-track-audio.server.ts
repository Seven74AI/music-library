import { type ExtractedAudioMetadata } from '#app/utils/audio-metadata.server'
import { prisma } from '#app/utils/db.server.ts'
import { buildAudioObjectKey, uploadFile } from '#app/utils/storage.server'
import { type Prisma } from '#prisma/client.js'
import { backfillTrackMetadata } from './backfill-track-metadata.server.ts'

type UploadProgress = {
	loaded?: number
	total?: number
}

export type PersistTrackAudioParams = {
	trackId: string
	serviceName: string
	buffer: Buffer
	metadata: ExtractedAudioMetadata
	uploadedBy?: string
	serviceId?: string | null
	fileName?: string
	extension?: string
	storageMetadata?: Record<string, string>
	onProgress?: (progress: UploadProgress) => void
	tx?: Prisma.TransactionClient
}

export type PersistTrackAudioResult = {
	audioFile: { id: string; trackId: string; objectKey: string }
	objectKey: string
	created: boolean
}

function getAudioExtension(
	metadata: ExtractedAudioMetadata,
	fileName?: string,
	extension?: string,
): string {
	if (extension) return extension.replace(/^\./, '').toLowerCase()
	if (fileName) {
		const extFromName = fileName.split('.').pop()?.toLowerCase()
		if (extFromName) return extFromName
	}
	return metadata.format || 'mp3'
}

function runBackfillBestEffort(trackId: string, metadata: ExtractedAudioMetadata): void {
	void backfillTrackMetadata(trackId, metadata).catch((error) => {
		console.error(
			`Failed to update track metadata from audio file for track ${trackId}:`,
			error,
		)
	})
}

/**
 * Persist track audio: upload to Tigris, create TrackAudioFile, then best-effort metadata backfill.
 *
 * Order is fixed: build key → upload (always first) → create TrackAudioFile → backfill.
 * Idempotent when a matching TrackAudioFile already exists (archive retry).
 */
export async function persistTrackAudio(
	params: PersistTrackAudioParams,
): Promise<PersistTrackAudioResult> {
	const {
		trackId,
		serviceName,
		buffer,
		metadata,
		uploadedBy,
		serviceId = null,
		fileName,
		extension: extensionOverride,
		storageMetadata,
		onProgress,
		tx,
	} = params

	const db = tx ?? prisma
	const format = metadata.format || 'mp3'
	const extension = getAudioExtension(metadata, fileName, extensionOverride)

	const existing = await db.trackAudioFile.findFirst({
		where: {
			trackId,
			format,
			serviceId,
		},
		select: {
			id: true,
			trackId: true,
			objectKey: true,
		},
	})

	if (existing) {
		if (!tx) runBackfillBestEffort(trackId, metadata)
		return { audioFile: existing, objectKey: existing.objectKey, created: false }
	}

	const objectKey = buildAudioObjectKey(serviceName, trackId, extension)

	await uploadFile({
		file: buffer,
		key: objectKey,
		contentType: metadata.mimeType || 'audio/mpeg',
		metadata: storageMetadata,
		onProgress,
	})

	const audioFile = await db.trackAudioFile.create({
		data: {
			trackId,
			serviceId,
			objectKey,
			fileName: fileName ?? objectKey.split('/').pop(),
			format,
			mimeType: metadata.mimeType || 'audio/mpeg',
			fileSize: buffer.length,
			bitrate: metadata.bitrate ?? null,
			sampleRate: metadata.sampleRate ?? null,
			uploadedBy: uploadedBy ?? null,
		},
		select: {
			id: true,
			trackId: true,
			objectKey: true,
		},
	})

	if (!tx) runBackfillBestEffort(trackId, metadata)

	return { audioFile, objectKey, created: true }
}
