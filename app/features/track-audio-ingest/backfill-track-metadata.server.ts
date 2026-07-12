import { getOrCreateArtist } from '#app/utils/artist-management.server'
import { type ExtractedAudioMetadata } from '#app/utils/audio-metadata.server'
import { getOrCreateAlbum } from '#app/utils/cover-management.server'
import { prisma } from '#app/utils/db.server.ts'

function parseOptionalDate(value?: string): Date | undefined {
	if (!value) return undefined
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Best-effort metadata backfill from an archived or uploaded audio file.
 * Failures are logged by the caller — persist must not fail when backfill throws.
 */
export async function backfillTrackMetadata(
	trackId: string,
	metadata: ExtractedAudioMetadata,
): Promise<void> {
	const trackUpdateData: Record<string, unknown> = {}
	const existingTrack = await prisma.track.findUnique({
		where: { id: trackId },
		select: { artistId: true },
	})

	if (metadata.title) trackUpdateData.title = metadata.title
	if (metadata.duration !== undefined) trackUpdateData.duration = metadata.duration
	if (metadata.albumArtist) trackUpdateData.albumArtist = metadata.albumArtist
	if (metadata.bpm !== undefined) trackUpdateData.bpm = metadata.bpm
	if (metadata.label) trackUpdateData.label = metadata.label
	if (metadata.isrc) trackUpdateData.isrc = metadata.isrc
	if (metadata.originalYear !== undefined) trackUpdateData.originalYear = metadata.originalYear
	if (metadata.totalTracks !== undefined) trackUpdateData.totalTracks = metadata.totalTracks
	if (metadata.totalDiscs !== undefined) trackUpdateData.totalDiscs = metadata.totalDiscs
	if (metadata.lyrics) trackUpdateData.lyrics = metadata.lyrics
	if (metadata.track?.no !== undefined) trackUpdateData.trackNumber = metadata.track.no
	if (metadata.genre && metadata.genre.length > 0) {
		trackUpdateData.genre = metadata.genre[0]
	}

	const releaseDate = parseOptionalDate(metadata.releaseDate)
	if (releaseDate) trackUpdateData.releaseDate = releaseDate

	const originalDate = parseOptionalDate(metadata.originalDate)
	if (originalDate) trackUpdateData.originalDate = originalDate

	let artistId = existingTrack?.artistId
	if (metadata.artist) {
		const artist = await getOrCreateArtist(metadata.artist)
		artistId = artist.id
		trackUpdateData.artistId = artist.id
	}

	if (metadata.album && artistId) {
		const album = await getOrCreateAlbum(artistId, metadata.album, metadata.year)
		if (album) {
			trackUpdateData.albumId = album.id
		}
	}

	if (metadata.year !== undefined) trackUpdateData.year = metadata.year

	if (Object.keys(trackUpdateData).length === 0) return

	await prisma.track.update({
		where: { id: trackId },
		data: trackUpdateData,
	})
}
