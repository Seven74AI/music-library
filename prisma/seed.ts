import 'dotenv/config'
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { createId } from '@paralleldrive/cuid2'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { LOCAL_SERVICE } from '#app/constants/services'
import { getOrCreateArtistTx, extractArtistMetadata } from '#app/utils/artist-management.server'
import { extractAudioMetadata } from '#app/utils/audio-metadata.server'
import { findOrCreateCoverImageTx, getOrCreateAlbumTx } from '#app/utils/cover-management.server'
import { uploadFile } from '#app/utils/storage.server'
import { PrismaClient } from '#prisma/client.js'
import {
	createPassword,
	createUser,
	getUserImages,
} from '#tests/db-utils.ts'

// Create Prisma Client directly using DATABASE_URL from environment
// This ensures seed uses the same DATABASE_URL as migrations (both read from .env)
const adapter = new PrismaBetterSqlite3({
	url: process.env.DATABASE_URL || 'file:./prisma/data.db',
})

const prisma = new PrismaClient({ adapter })

async function seed() {
	console.log('🌱 Seeding...')
	console.time(`🌱 Database has been seeded`)

	// Seed Services first (required for other entities)
	console.time(`🎵 Seeded services`)
	await prisma.service.upsert({
		where: { id: 'clnf2zvli0000pcou3zzzzome' },
		update: {},
		create: {
			id: 'clnf2zvli0000pcou3zzzzome',
			name: 'youtube',
			displayName: 'YouTube',
			baseUrl: 'https://youtube.com',
			logoUrl: '/logos/youtube.svg',
			isActive: true,
		},
	})
	
	await prisma.service.upsert({
		where: { name: 'local' },
		update: {},
		create: {
			name: 'local',
			displayName: 'Local Upload',
			baseUrl: '',
			logoUrl: null,
			isActive: true,
		},
	})
	console.timeEnd(`🎵 Seeded services`)

	const totalUsers = 5
	console.time(`👤 Created ${totalUsers} users...`)
	const userImages = await getUserImages()

	for (let index = 0; index < totalUsers; index++) {
		const userData = createUser()
		const user = await prisma.user.create({
			select: { id: true },
			data: {
				...userData,
				password: { create: createPassword(userData.username) },
				roles: { connect: { name: 'user' } },
			},
		})

		// Upload user profile image
		const userImage = userImages[index % userImages.length]
		if (userImage) {
			await prisma.userImage.create({
				data: {
					userId: user.id,
					objectKey: userImage.objectKey,
				},
			})
		}

	}
	console.timeEnd(`👤 Created ${totalUsers} users...`)

	console.time(`🐨 Created admin user "kody"`)

	const kodyImages = {
		kodyUser: { objectKey: 'user/kody.png' },
	}

	const kody = await prisma.user.upsert({
		where: { username: 'kody' },
		select: { id: true },
		update: {},
		create: {
			email: 'kody@kcd.dev',
			username: 'kody',
			name: 'Kody',
			password: { create: createPassword('kodylovesyou') },
			roles: { connect: [{ name: 'admin' }, { name: 'user' }] },
		},
	})

	await prisma.userImage.upsert({
		where: { userId: kody.id },
		update: {
			objectKey: kodyImages.kodyUser.objectKey,
		},
		create: {
			userId: kody.id,
			objectKey: kodyImages.kodyUser.objectKey,
		},
	})

	// Seed audio files for kody
	await seedAudioFiles(kody.id)

	console.time(`👤 Created regular user "kodyuser"`)

	const kodyuser = await prisma.user.upsert({
		where: { username: 'kodyuser' },
		select: { id: true },
		update: {},
		create: {
			email: 'kodyuser@kcd.dev',
			username: 'kodyuser',
			name: 'Kody User',
			password: { create: createPassword('kodylovesyou') },
			roles: { connect: { name: 'user' } },
		},
	})

	await prisma.userImage.upsert({
		where: { userId: kodyuser.id },
		update: {
			objectKey: kodyImages.kodyUser.objectKey,
		},
		create: {
			userId: kodyuser.id,
			objectKey: kodyImages.kodyUser.objectKey,
		},
	})

	console.timeEnd(`👤 Created regular user "kodyuser"`)

	console.timeEnd(`🌱 Database has been seeded`)
}

/**
 * Generate storage key for audio file
 */
function generateAudioFileKey(
	trackId: string,
	serviceId: string | null,
	format: string,
	fileId: string,
	extension: string
): string {
	const service = serviceId || 'local'
	const timestamp = Date.now()
	return `audio/tracks/${trackId}/${service}/${format}/${timestamp}-${fileId}.${extension}`
}

/**
 * Get file extension from filename or MIME type
 */
function getFileExtension(fileName: string, mimeType?: string | null): string {
	// Try filename first
	const extFromName = fileName.split('.').pop()?.toLowerCase()
	if (extFromName) {
		return extFromName
	}

	// Fallback to MIME type
	if (mimeType) {
		const mimeToExt: Record<string, string> = {
			'audio/mpeg': 'mp3',
			'audio/mp3': 'mp3',
			'audio/flac': 'flac',
			'audio/wav': 'wav',
			'audio/wave': 'wav',
			'audio/mp4': 'm4a',
			'audio/m4a': 'm4a',
			'audio/aac': 'aac',
			'audio/ogg': 'ogg',
			'audio/webm': 'webm',
		}
		return mimeToExt[mimeType] || 'mp3'
	}

	return 'mp3' // Default fallback
}

/**
 * Check if storage is configured
 */
function isStorageConfigured(): boolean {
	return !!(
		process.env.AWS_ENDPOINT_URL_S3 &&
		process.env.BUCKET_NAME &&
		process.env.AWS_ACCESS_KEY_ID &&
		process.env.AWS_SECRET_ACCESS_KEY &&
		process.env.AWS_REGION
	)
}

/**
 * Upload file to local filesystem (for development)
 */
async function uploadFileLocal(file: Buffer, key: string): Promise<string> {
	const localStorageDir = join(process.cwd(), 'tests', 'fixtures', 'uploaded')
	const filePath = join(localStorageDir, key)
	const fileDir = dirname(filePath)
	
	// Create directory structure if it doesn't exist
	mkdirSync(fileDir, { recursive: true })
	
	// Write file to local filesystem
	writeFileSync(filePath, file)
	
	console.log(`📁 Saved file locally: ${filePath}`)
	return key
}

/**
 * Seed audio files from all albums in prisma/seed-data/audio/
 */
async function seedAudioFiles(userId: string) {
	const audioDataPath = join(process.cwd(), 'prisma', 'seed-data', 'audio')
	
	// Check if directory exists
	if (!existsSync(audioDataPath)) {
		console.log('⚠️  Audio seed data directory not found, skipping audio file seeding')
		return
	}

	// Use local file storage in development if storage is not configured
	const useLocalStorage = !isStorageConfigured()
	if (useLocalStorage) {
		console.log('📁 Using local file storage (storage not configured, saving to tests/fixtures/uploaded/)')
	}

	// Get all album directories
	const albumDirs = readdirSync(audioDataPath, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name)
		.sort()

	if (albumDirs.length === 0) {
		console.log('⚠️  No album directories found in seed-data/audio, skipping audio file seeding')
		return
	}

	console.log(`📀 Found ${albumDirs.length} album(s) to seed: ${albumDirs.join(', ')}`)

	let totalFilesProcessed = 0

	// Process each album
	for (const albumDir of albumDirs) {
		const albumPath = join(audioDataPath, albumDir)
		
		// Get all FLAC files in the album directory
		const files = readdirSync(albumPath)
			.filter(file => file.toLowerCase().endsWith('.flac'))
			.sort()

		if (files.length === 0) {
			console.warn(`⚠️  No FLAC files found in ${albumDir}, skipping`)
			continue
		}

		console.time(`🎵 Seeded ${files.length} files from ${albumDir}`)

		try {
			// Get local service
			const localService = await prisma.service.findUnique({
				where: { name: LOCAL_SERVICE.NAME },
			})

			if (!localService) {
				console.error('❌ Local service not found, skipping audio file seeding')
				continue
			}

			const createdTracks: Array<{ id: string; title: string }> = []

		// Process each file
		for (const fileName of files) {
			const filePath = join(albumPath, fileName)

			// Check if file exists
			if (!existsSync(filePath)) {
				console.warn(`⚠️  File not found: ${fileName}, skipping`)
				continue
			}

			try {
				// Read file
				const fileBuffer = readFileSync(filePath)
				const stats = statSync(filePath)

				// Extract metadata
				const extractedMetadata = await extractAudioMetadata(fileBuffer, fileName)

				// Use metadata or fallback to filename parsing
				// Try to extract title from filename (remove artist prefix and track number)
				let title = extractedMetadata.title
				if (!title) {
					// Remove file extension
					title = fileName.replace(/\.flac$/i, '')
					// Try to remove common patterns: "Artist - Album - NN-NN Title" or "Artist - Title"
					title = title.replace(/^[^-]+ - [^-]+ - \d{2}-\d{2} /, '') // Remove "Artist - Album - NN-NN "
					title = title.replace(/^[^-]+ - /, '') // Remove "Artist - " if still present
				}
				
				// Extract artist from metadata or try to parse from album directory name
				let artist = extractedMetadata.artist
				if (!artist) {
					// Try to extract from album directory name (format: "Artist - Album [Year]")
					const artistMatch = albumDir.match(/^([^-]+) - /)
					artist = artistMatch && artistMatch[1] ? artistMatch[1].trim() : 'Unknown Artist'
				}
				
				// Extract album from metadata or use directory name
				let album = extractedMetadata.album
				if (!album) {
					// Use directory name as album (format: "Artist - Album [Year]")
					album = albumDir
				}

				// Generate IDs
				const trackId = createId()
				const fileId = createId()
				const format = extractedMetadata.format || 'flac'
				const extension = getFileExtension(fileName, extractedMetadata.mimeType)
				const objectKey = generateAudioFileKey(
					trackId,
					localService.id,
					format,
					fileId,
					extension
				)

				// Upload file to storage (local or remote)
				let uploadSuccess = false
				try {
					if (useLocalStorage) {
						// Use local file storage
						await uploadFileLocal(fileBuffer, objectKey)
						uploadSuccess = true
					} else {
						// Try remote storage first, fall back to local if it fails
						try {
							await uploadFile({
								file: fileBuffer,
								key: objectKey,
								contentType: extractedMetadata.mimeType || 'audio/flac',
								metadata: {
									title: title,
									artist: artist,
									album: album || '',
									uploadedBy: userId,
								},
							})
							uploadSuccess = true
						} catch {
							// Fall back to local storage if remote fails
							console.warn(`⚠️  Remote storage failed for ${fileName}, falling back to local storage`)
							await uploadFileLocal(fileBuffer, objectKey)
							uploadSuccess = true
						}
					}
				} catch (uploadError) {
					console.error(`❌ Failed to upload ${fileName}:`, uploadError)
					console.warn(`⚠️  Skipping database record creation for ${fileName} (upload failed)`)
					// Skip creating database record if upload fails
					continue
				}

				// Only create track and audio file if upload succeeded
				if (!uploadSuccess) {
					continue
				}

				// Create track and audio file in transaction
				// All database operations (Artist, Album, CoverImage, Track) happen here
				await prisma.$transaction(async (tx) => {
					// Get or create artist
					const artistMetadata = extractArtistMetadata(extractedMetadata)
					const artistRecord = await getOrCreateArtistTx(tx, artist, artistMetadata)

					// Get or create album (using artistId)
					const albumArtist = extractedMetadata.albumArtist || artist
					const albumArtistRecord = await getOrCreateArtistTx(tx, albumArtist, artistMetadata)
					const albumRecord = await getOrCreateAlbumTx(
						tx,
						albumArtistRecord.id,
						album || null,
						extractedMetadata.year || null
					)

					// Upload cover image if present (with deduplication)
					// Note: File upload happens outside transaction, but DB operations are in transaction
					let coverImageId: string | null = null
					if (extractedMetadata.coverImage) {
						try {
							const coverImage = await findOrCreateCoverImageTx(tx, {
								imageBuffer: extractedMetadata.coverImage.data,
								albumId: albumRecord?.id || null,
								trackId,
								format: extractedMetadata.coverImage.format,
							})
							coverImageId = coverImage.id
						} catch (error) {
							console.warn(`⚠️  Failed to upload cover image for ${fileName}:`, error)
							// Continue without cover image
						}
					}
					// Parse releaseDate and originalDate if they exist
					const releaseDate = extractedMetadata.releaseDate
						? new Date(extractedMetadata.releaseDate)
						: null
					const originalDate = extractedMetadata.originalDate
						? new Date(extractedMetadata.originalDate)
						: null

					// Extract genre (take first if array)
					const genre = Array.isArray(extractedMetadata.genre)
						? extractedMetadata.genre[0] || null
						: extractedMetadata.genre || null

					// Extract trackNumber from track.no
					const trackNumber = extractedMetadata.track?.no || null

					// Create track
					const track = await tx.track.create({
						data: {
							id: trackId,
							title,
							artistId: artistRecord.id,
							albumId: albumRecord?.id || null,
							coverImageId,
							duration: extractedMetadata.duration || null,
							serviceId: localService.id,
							externalId: fileId,
							serviceUrl: null,
							releaseDate: releaseDate,
							// New metadata fields
							genre: genre,
							year: extractedMetadata.year || null,
							trackNumber: trackNumber,
							albumArtist: extractedMetadata.albumArtist || null,
							bpm: extractedMetadata.bpm || null,
							label: extractedMetadata.label || null,
							isrc: extractedMetadata.isrc || null,
							originalDate: originalDate,
							originalYear: extractedMetadata.originalYear || null,
							totalTracks: extractedMetadata.totalTracks || null,
							totalDiscs: extractedMetadata.totalDiscs || null,
							lyrics: extractedMetadata.lyrics || null,
						},
					})

					// Create audio file record
					await tx.trackAudioFile.create({
						data: {
							trackId: track.id,
							serviceId: localService.id,
							objectKey,
							fileName: fileName,
							fileSize: stats.size,
							mimeType: extractedMetadata.mimeType || 'audio/flac',
							format,
							bitrate: extractedMetadata.bitrate || null,
							sampleRate: extractedMetadata.sampleRate || null,
							uploadedBy: userId,
						},
					})

					// Add track to user's library
					await tx.userTrack.create({
						data: {
							userId,
							trackId: track.id,
						},
					})

					createdTracks.push({ id: track.id, title: track.title })
				})

				console.log(`✅ Processed: ${title} by ${artist}`)
			} catch (error) {
				console.error(`❌ Error processing ${fileName}:`, error)
				// Continue with next file
			}
		}

		// Create playlist with all tracks from this album
		if (createdTracks.length > 0) {
			try {
				const playlist = await prisma.userPlaylist.create({
					data: {
						title: albumDir,
						description: 'Seeded album playlist',
						ownerId: userId,
						tracks: {
							create: createdTracks.map((track, index) => ({
								trackId: track.id,
								position: index + 1,
							})),
						},
					},
				})
				console.log(`✅ Created playlist: ${playlist.title} with ${createdTracks.length} tracks`)
			} catch (error) {
				console.error(`❌ Error creating playlist for ${albumDir}:`, error)
			}
		}

			totalFilesProcessed += createdTracks.length
			console.timeEnd(`🎵 Seeded ${files.length} files from ${albumDir}`)
		} catch (error) {
			console.error(`❌ Error processing album ${albumDir}:`, error)
			// Continue with next album
		}
	}

	console.log(`🎉 Total: Seeded ${totalFilesProcessed} audio files from ${albumDirs.length} album(s)`)
}

seed()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})

// we're ok to import from the test directory in this file
/*
eslint
	no-restricted-imports: "off",
*/
