// @context7: crypto, Buffer, Prisma, sharp
import { createHash } from 'node:crypto'
import { prisma } from '#app/utils/db.server'
import { type Prisma } from '#prisma/client.js'
import { uploadFile } from './storage.server'

/**
 * Download image from external URL
 * 
 * @param url - External image URL (e.g., YouTube thumbnail)
 * @param maxSize - Maximum file size in bytes (default: 5MB)
 * @returns Image buffer or null if download fails
 */
export async function downloadExternalImage(
	url: string,
	maxSize: number = 5 * 1024 * 1024 // 5MB default
): Promise<Buffer | null> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(10000), // 10 second timeout
		})

		if (!response.ok) {
			console.warn(`Failed to download image from ${url}: ${response.status} ${response.statusText}`)
			return null
		}

		const contentType = response.headers.get('content-type')
		if (!contentType || !contentType.startsWith('image/')) {
			console.warn(`Invalid content type for image from ${url}: ${contentType}`)
			return null
		}

		const contentLength = response.headers.get('content-length')
		if (contentLength && parseInt(contentLength, 10) > maxSize) {
			console.warn(`Image from ${url} exceeds max size: ${contentLength} bytes`)
			return null
		}

		const arrayBuffer = await response.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)

		// Check size after download (in case content-length header was missing)
		if (buffer.length > maxSize) {
			console.warn(`Image from ${url} exceeds max size: ${buffer.length} bytes`)
			return null
		}

		return buffer
	} catch (error) {
		console.warn(`Error downloading image from ${url}:`, error)
		return null
	}
}

/**
 * Calculate SHA-256 hash of image buffer for deduplication
 */
export async function calculateImageHash(buffer: Buffer): Promise<string> {
	return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Get or create an Album record
 * Uses (artistId, name) as unique identifier
 */
export async function getOrCreateAlbum(
	artistId: string,
	albumName: string | null | undefined,
	year?: number | null
): Promise<{ id: string } | null> {
	if (!albumName) {
		return null
	}

	const album = await prisma.album.upsert({
		where: {
			artistId_name: {
				artistId,
				name: albumName,
			},
		},
		update: {
			// Update year if provided and not already set
			...(year && { year }),
		},
		create: {
			name: albumName,
			artistId,
			...(year && { year }),
		},
		select: {
			id: true,
		},
	})

	return album
}

/**
 * Transaction-aware version of getOrCreateAlbum
 */
export async function getOrCreateAlbumTx(
	tx: Prisma.TransactionClient,
	artistId: string,
	albumName: string | null | undefined,
	year?: number | null
): Promise<{ id: string } | null> {
	if (!albumName) {
		return null
	}

	const album = await tx.album.upsert({
		where: {
			artistId_name: {
				artistId,
				name: albumName,
			},
		},
		update: {
			// Update year if provided and not already set
			...(year && { year }),
		},
		create: {
			name: albumName,
			artistId,
			...(year && { year }),
		},
		select: {
			id: true,
		},
	})

	return album
}

/**
 * Associate a cover image with an album
 */
export async function associateCoverWithAlbum(
	coverImageId: string,
	albumId: string
): Promise<void> {
	await prisma.album.update({
		where: { id: albumId },
		data: { coverImageId },
	})
}

/**
 * Transaction-aware version of associateCoverWithAlbum
 */
export async function associateCoverWithAlbumTx(
	tx: Prisma.TransactionClient,
	coverImageId: string,
	albumId: string
): Promise<void> {
	await tx.album.update({
		where: { id: albumId },
		data: { coverImageId },
	})
}

/**
 * Find or create a cover image with deduplication
 * 
 * Strategy:
 * 1. Calculate hash of image data
 * 2. Check if cover with same hash exists → reuse
 * 3. If album provided, check if album already has a cover → reuse album's cover
 * 4. Otherwise, upload new cover and create record
 * 
 * @param params - Cover image parameters
 * @returns CoverImage record
 */
export async function findOrCreateCoverImage(params: {
	imageBuffer: Buffer
	albumId?: string | null
	trackId?: string
	width?: number
	height?: number
	format?: string
}): Promise<{ id: string; objectKey: string }> {
	const { imageBuffer, albumId, trackId, width, height, format } = params

	// Step 1: Calculate hash
	const contentHash = await calculateImageHash(imageBuffer)

	// Step 2: Check if cover with same hash exists
	const existingCover = await prisma.coverImage.findUnique({
		where: { contentHash },
		select: { id: true, objectKey: true },
	})

	if (existingCover) {
		// Reuse existing cover
		// If album provided and doesn't have a cover, associate it
		if (albumId) {
			const album = await prisma.album.findUnique({
				where: { id: albumId },
				select: { coverImageId: true },
			})
			if (album && !album.coverImageId) {
				await associateCoverWithAlbum(existingCover.id, albumId)
			}
		}
		return existingCover
	}

	// Step 3: If album provided, check if album already has a cover
	if (albumId) {
		const album = await prisma.album.findUnique({
			where: { id: albumId },
			include: { coverImage: { select: { id: true, objectKey: true } } },
		})

		if (album?.coverImage) {
			// Album already has a cover, reuse it
			return {
				id: album.coverImage.id,
				objectKey: album.coverImage.objectKey,
			}
		}
	}

	// Step 4: Upload new cover and create record
	// Import sharp dynamically (only when needed)
	const sharp = await import('sharp').catch(() => null)
	if (!sharp) {
		throw new Error('sharp is not available for image processing')
	}

	// Process image: resize to max 1000x1000, convert to JPEG, optimize
	const processedImage = await sharp.default(imageBuffer)
		.resize(1000, 1000, {
			fit: 'inside',
			withoutEnlargement: true,
		})
		.jpeg({ quality: 85 })
		.toBuffer()

	// Get image metadata for dimensions
	const metadata = await sharp.default(processedImage).metadata()
	const finalWidth = width || metadata.width || null
	const finalHeight = height || metadata.height || null
	const finalFormat = format || 'jpeg'
	const fileSize = processedImage.length

	// Generate storage key
	const { createId } = await import('@paralleldrive/cuid2')
	const fileId = createId()
	const timestamp = Date.now()
	const objectKey = trackId
		? `images/tracks/${trackId}/cover/${timestamp}-${fileId}.jpg`
		: `images/covers/${timestamp}-${fileId}.jpg`

	// Upload to storage
	await uploadFile({
		file: processedImage,
		key: objectKey,
		contentType: 'image/jpeg',
		metadata: {
			...(trackId && { trackId }),
			type: 'album-art',
			contentHash,
		},
	})

	// Create cover image record
	const coverImage = await prisma.coverImage.create({
		data: {
			contentHash,
			objectKey,
			width: finalWidth,
			height: finalHeight,
			format: finalFormat,
			fileSize,
		},
		select: {
			id: true,
			objectKey: true,
		},
	})

	// Associate with album if provided
	if (albumId) {
		await associateCoverWithAlbum(coverImage.id, albumId)
	}

	return coverImage
}

/**
 * Transaction-aware version of findOrCreateCoverImage
 * Note: File upload still happens outside transaction, but database operations are within transaction
 */
export async function findOrCreateCoverImageTx(
	tx: Prisma.TransactionClient,
	params: {
		imageBuffer: Buffer
		albumId?: string | null
		trackId?: string
		width?: number
		height?: number
		format?: string
	}
): Promise<{ id: string; objectKey: string }> {
	const { imageBuffer, albumId, trackId, width, height, format } = params

	// Step 1: Calculate hash
	const contentHash = await calculateImageHash(imageBuffer)

	// Step 2: Check if cover with same hash exists
	const existingCover = await tx.coverImage.findUnique({
		where: { contentHash },
		select: { id: true, objectKey: true },
	})

	if (existingCover) {
		// Reuse existing cover
		// If album provided and doesn't have a cover, associate it
		if (albumId) {
			const album = await tx.album.findUnique({
				where: { id: albumId },
				select: { coverImageId: true },
			})
			if (album && !album.coverImageId) {
				await associateCoverWithAlbumTx(tx, existingCover.id, albumId)
			}
		}
		return existingCover
	}

	// Step 3: If album provided, check if album already has a cover
	if (albumId) {
		const album = await tx.album.findUnique({
			where: { id: albumId },
			include: { coverImage: { select: { id: true, objectKey: true } } },
		})

		if (album?.coverImage) {
			// Album already has a cover, reuse it
			return {
				id: album.coverImage.id,
				objectKey: album.coverImage.objectKey,
			}
		}
	}

	// Step 4: Upload new cover and create record
	// Import sharp dynamically (only when needed)
	const sharp = await import('sharp').catch(() => null)
	if (!sharp) {
		throw new Error('sharp is not available for image processing')
	}

	// Process image: resize to max 1000x1000, convert to JPEG, optimize
	const processedImage = await sharp.default(imageBuffer)
		.resize(1000, 1000, {
			fit: 'inside',
			withoutEnlargement: true,
		})
		.jpeg({ quality: 85 })
		.toBuffer()

	// Get image metadata for dimensions
	const metadata = await sharp.default(processedImage).metadata()
	const finalWidth = width || metadata.width || null
	const finalHeight = height || metadata.height || null
	const finalFormat = format || 'jpeg'
	const fileSize = processedImage.length

	// Generate storage key
	const { createId } = await import('@paralleldrive/cuid2')
	const fileId = createId()
	const timestamp = Date.now()
	const objectKey = trackId
		? `images/tracks/${trackId}/cover/${timestamp}-${fileId}.jpg`
		: `images/covers/${timestamp}-${fileId}.jpg`

	// Upload to storage (outside transaction - storage operations can't be rolled back)
	await uploadFile({
		file: processedImage,
		key: objectKey,
		contentType: 'image/jpeg',
		metadata: {
			...(trackId && { trackId }),
			type: 'album-art',
			contentHash,
		},
	})

	// Create cover image record (within transaction)
	const coverImage = await tx.coverImage.create({
		data: {
			contentHash,
			objectKey,
			width: finalWidth,
			height: finalHeight,
			format: finalFormat,
			fileSize,
		},
		select: {
			id: true,
			objectKey: true,
		},
	})

	// Associate with album if provided (within transaction)
	if (albumId) {
		await associateCoverWithAlbumTx(tx, coverImage.id, albumId)
	}

	return coverImage
}

