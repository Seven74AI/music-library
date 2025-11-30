// @context7: Prisma, crypto, Buffer
import { createId } from '@paralleldrive/cuid2'
import { prisma } from '#app/utils/db.server'
import { type Prisma } from '#prisma/client.js'
import { type ExtractedAudioMetadata } from './audio-metadata.server'

/**
 * Normalize artist name for consistent matching
 * - Convert to lowercase
 * - Trim whitespace
 * - Normalize special characters (basic normalization)
 */
export function normalizeArtistName(name: string): string {
	if (!name || typeof name !== 'string') {
		return ''
	}
	return name
		.trim()
		.toLowerCase()
		// Normalize common special characters
		.replace(/\s+/g, ' ') // Multiple spaces to single space
		.replace(/['"]/g, '') // Remove quotes
		.replace(/[^\w\s-]/g, '') // Remove special chars except word chars, spaces, hyphens
}

/**
 * Extract artist metadata from audio file metadata
 */
export function extractArtistMetadata(
	metadata: ExtractedAudioMetadata
): {
	genre?: string
	country?: string
} {
	const genre = Array.isArray(metadata.genre)
		? metadata.genre[0] || undefined
		: metadata.genre || undefined

	return {
		genre,
		// Country is not typically in audio metadata, but we can extract it if available
		// For now, leave it undefined
	}
}

/**
 * Find all artists with matching normalized name
 */
export async function findArtistsByName(name: string): Promise<
	Array<{
		id: string
		name: string
		normalizedName: string
	}>
> {
	const normalizedName = normalizeArtistName(name)
	if (!normalizedName) {
		return []
	}

	return await prisma.artist.findMany({
		where: { normalizedName },
		select: {
			id: true,
			name: true,
			normalizedName: true,
		},
		orderBy: { createdAt: 'asc' }, // First match = oldest
	})
}

/**
 * Get or create an Artist record
 * Uses normalized name for matching
 * If multiple artists with same normalized name exist, uses the first match
 */
export async function getOrCreateArtist(
	name: string,
	metadata?: {
		genre?: string
		country?: string
		bio?: string
		imageUrl?: string
		website?: string
	}
): Promise<{ id: string; name: string }> {
	if (!name || typeof name !== 'string' || name.trim().length === 0) {
		throw new Error('Artist name is required')
	}

	const normalizedName = normalizeArtistName(name)

	// Find existing artists with same normalized name
	const existingArtists = await findArtistsByName(name)

	if (existingArtists.length > 0 && existingArtists[0]) {
		// Use first match (oldest)
		return {
			id: existingArtists[0].id,
			name: existingArtists[0].name,
		}
	}

	// Create new artist
	const artist = await prisma.artist.create({
		data: {
			id: createId(),
			name: name.trim(),
			normalizedName,
			...(metadata?.genre && { genre: metadata.genre }),
			...(metadata?.country && { country: metadata.country }),
			...(metadata?.bio && { bio: metadata.bio }),
			...(metadata?.imageUrl && { imageUrl: metadata.imageUrl }),
			...(metadata?.website && { website: metadata.website }),
		},
		select: {
			id: true,
			name: true,
		},
	})

	return artist
}

/**
 * Transaction-aware version of getOrCreateArtist
 * Accepts a Prisma transaction client
 */
export async function getOrCreateArtistTx(
	tx: Prisma.TransactionClient,
	name: string,
	metadata?: {
		genre?: string
		country?: string
		bio?: string
		imageUrl?: string
		website?: string
	}
): Promise<{ id: string; name: string }> {
	if (!name || typeof name !== 'string' || name.trim().length === 0) {
		throw new Error('Artist name is required')
	}

	const normalizedName = normalizeArtistName(name)

	// Find existing artists with same normalized name
	const existingArtists = await tx.artist.findMany({
		where: { normalizedName },
		select: {
			id: true,
			name: true,
			normalizedName: true,
		},
		orderBy: { createdAt: 'asc' },
	})

	if (existingArtists.length > 0 && existingArtists[0]) {
		// Use first match (oldest)
		return {
			id: existingArtists[0].id,
			name: existingArtists[0].name,
		}
	}

	// Create new artist
	const artist = await tx.artist.create({
		data: {
			id: createId(),
			name: name.trim(),
			normalizedName,
			...(metadata?.genre && { genre: metadata.genre }),
			...(metadata?.country && { country: metadata.country }),
			...(metadata?.bio && { bio: metadata.bio }),
			...(metadata?.imageUrl && { imageUrl: metadata.imageUrl }),
			...(metadata?.website && { website: metadata.website }),
		},
		select: {
			id: true,
			name: true,
		},
	})

	return artist
}

