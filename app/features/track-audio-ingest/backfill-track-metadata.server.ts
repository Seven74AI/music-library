import { getOrCreateArtist } from "#app/utils/artist-management.server";
import { type ExtractedAudioMetadata } from "#app/utils/audio-metadata.server";
import { getOrCreateAlbum } from "#app/utils/album-management.server";
import { prisma } from "#app/utils/db.server.ts";
import { replaceTrackGenresFromStrings } from "#app/utils/track-genres.server.ts";
import { coerceOptionalInt, pickIntField } from "#app/utils/track-metadata-int.server.ts";

function assignOptionalInt(data: Record<string, unknown>, key: string, value: unknown) {
  const coerced = coerceOptionalInt(value);
  if (coerced !== undefined) data[key] = coerced;
}

function parseOptionalDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type BackfillTrackMetadataOptions = {
  /** Keep the track title already stored (e.g. curator form input). */
  preserveTitle?: boolean;
  /** Keep the linked artist from the upload transaction. */
  preserveArtist?: boolean;
  /** Keep the linked album from the upload transaction. */
  preserveAlbum?: boolean;
};

/**
 * Best-effort metadata backfill from an archived or uploaded audio file.
 * Failures are logged by the caller — persist must not fail when backfill throws.
 */
export async function backfillTrackMetadata(
  trackId: string,
  metadata: ExtractedAudioMetadata,
  options: BackfillTrackMetadataOptions = {},
): Promise<void> {
  const trackUpdateData: Record<string, unknown> = {};
  const existingTrack = await prisma.track.findUnique({
    where: { id: trackId },
    select: { artistId: true },
  });

  if (metadata.title && !options.preserveTitle) trackUpdateData.title = metadata.title;
  if (metadata.duration !== undefined) trackUpdateData.duration = metadata.duration;
  if (metadata.albumArtist) trackUpdateData.albumArtist = metadata.albumArtist;
  assignOptionalInt(trackUpdateData, "bpm", metadata.bpm);
  if (metadata.label) trackUpdateData.label = metadata.label;
  if (metadata.isrc) trackUpdateData.isrc = metadata.isrc;
  assignOptionalInt(trackUpdateData, "originalYear", metadata.originalYear);
  assignOptionalInt(trackUpdateData, "totalTracks", metadata.totalTracks);
  assignOptionalInt(trackUpdateData, "totalDiscs", metadata.totalDiscs);
  if (metadata.lyrics) trackUpdateData.lyrics = metadata.lyrics;
  assignOptionalInt(trackUpdateData, "trackNumber", metadata.track?.no);
  const releaseDate = parseOptionalDate(metadata.releaseDate);
  if (releaseDate) trackUpdateData.releaseDate = releaseDate;

  const originalDate = parseOptionalDate(metadata.originalDate);
  if (originalDate) trackUpdateData.originalDate = originalDate;

  let artistId = existingTrack?.artistId;
  if (metadata.artist && !options.preserveArtist) {
    const artist = await getOrCreateArtist(metadata.artist);
    artistId = artist.id;
    trackUpdateData.artistId = artist.id;
  }

  if (metadata.album && artistId && !options.preserveAlbum) {
    const album = await getOrCreateAlbum(artistId, metadata.album, pickIntField(metadata.year));
    if (album) {
      trackUpdateData.albumId = album.id;
    }
  }

  assignOptionalInt(trackUpdateData, "year", metadata.year);

  const hasScalarPatch = Object.keys(trackUpdateData).length > 0;
  const hasGenreBackfill = (metadata.genre?.length ?? 0) > 0;
  if (!hasScalarPatch && !hasGenreBackfill) return;

  if (hasScalarPatch) {
    await prisma.track.update({
      where: { id: trackId },
      data: trackUpdateData,
    });
  }

  if (hasGenreBackfill) {
    await replaceTrackGenresFromStrings(prisma, trackId, metadata.genre);
  }
}
