import { getOrCreateArtistTx, type ArtistMetadata } from "#app/utils/artist-management.server";
import { type ExtractedAudioMetadata } from "#app/utils/audio-metadata.server";
import { getOrCreateAlbumTx } from "#app/utils/album-management.server";
import {
  abandonUnpersistedPreparedCover,
  createCoverImageInTx,
  type PreparedCoverImage,
} from "#app/utils/cover-management.server";
import { prisma } from "#app/utils/db.server.ts";
import { type Prisma } from "#prisma/client.js";
import {
  backfillTrackMetadata,
  type BackfillTrackMetadataOptions,
} from "./backfill-track-metadata.server.ts";
import { createTrackAudioFile, type PreparedTrackAudio } from "./persist-track-audio.server.ts";

export type LocalUploadUserMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  albumArtist?: string;
  bpm?: number;
  label?: string;
  isrc?: string;
  originalDate?: string;
  originalYear?: number;
  releaseDate?: string;
  totalTracks?: number;
  totalDiscs?: number;
  lyrics?: string;
};

export type CreateLocalUploadTransactionHooks = {
  beforeTrackCreate?: () => void | Promise<void>;
  afterTrackCreate?: () => void | Promise<void>;
  beforeAudioFile?: () => void | Promise<void>;
  afterAudioFile?: () => void | Promise<void>;
  beforeUserTrack?: () => void | Promise<void>;
  afterUserTrack?: () => void | Promise<void>;
};

/** When set, updated when an unpersisted cover object is abandoned so callers can avoid double cleanup. */
export type PreparedCoverHolder = { current: PreparedCoverImage | null };

export type CreateLocalUploadInTransactionParams = {
  tx: Prisma.TransactionClient;
  trackId: string;
  externalId: string;
  userId: string;
  serviceId: string;
  title: string;
  artist: string;
  artistMetadata: ArtistMetadata;
  album: string | null;
  albumArtist: string;
  yearForAlbum: number | null | undefined;
  extractedMetadata: ExtractedAudioMetadata;
  preparedCover: PreparedCoverImage | null;
  preparedCoverHolder?: PreparedCoverHolder;
  preparedAudio: PreparedTrackAudio;
  audioFileName: string;
  buffer: Buffer;
  uploadedBy: string;
  hooks?: CreateLocalUploadTransactionHooks;
  onCoverPersistFailure?: (error: unknown) => void | Promise<void>;
};

export type CreateLocalUploadInTransactionResult = {
  track: { id: string; title: string; artistId: string; albumId: string | null };
  artistName: string;
  preparedCover: PreparedCoverImage | null;
};

/**
 * Persist the core local-upload track rows inside an existing transaction.
 * Writes only the thin track identity (title, artist, album link, duration, cover);
 * extended metadata is applied later via {@link runLocalUploadMetadataBackfill}.
 */
export async function createLocalUploadInTransaction(
  params: CreateLocalUploadInTransactionParams,
): Promise<CreateLocalUploadInTransactionResult> {
  const {
    tx,
    trackId,
    externalId,
    userId,
    serviceId,
    title,
    artist,
    artistMetadata,
    album,
    albumArtist,
    yearForAlbum,
    extractedMetadata,
    preparedAudio,
    audioFileName,
    buffer,
    uploadedBy,
    hooks,
    onCoverPersistFailure,
    preparedCoverHolder,
  } = params;
  let preparedCover = params.preparedCover;
  if (preparedCoverHolder) {
    preparedCoverHolder.current = preparedCover;
  }

  const artistRecord = await getOrCreateArtistTx(tx, artist, artistMetadata);
  const albumArtistRecord = await getOrCreateArtistTx(tx, albumArtist, artistMetadata);
  const albumRecord = await getOrCreateAlbumTx(tx, albumArtistRecord.id, album, yearForAlbum);

  let coverImageId: string | null = null;
  if (preparedCover) {
    try {
      const coverImage = await createCoverImageInTx(tx, preparedCover, albumRecord?.id ?? null);
      coverImageId = coverImage.id;
    } catch (error) {
      await onCoverPersistFailure?.(error);
      if (preparedCover?.kind === "new") {
        await abandonUnpersistedPreparedCover(preparedCover);
        preparedCover = null;
        if (preparedCoverHolder) {
          preparedCoverHolder.current = null;
        }
      }
    }
  }

  await hooks?.beforeTrackCreate?.();
  const track = await tx.track.create({
    data: {
      id: trackId,
      title,
      artistId: artistRecord.id,
      albumId: albumRecord?.id || null,
      coverImageId,
      duration: extractedMetadata.duration || null,
      serviceId,
      externalId,
      serviceUrl: null,
      releaseDate: null,
    },
  });
  await hooks?.afterTrackCreate?.();

  await hooks?.beforeAudioFile?.();
  await createTrackAudioFile(
    {
      trackId: track.id,
      serviceId,
      fileName: audioFileName,
      metadata: extractedMetadata,
      uploadedBy,
      buffer,
    },
    preparedAudio,
    tx,
  );
  await hooks?.afterAudioFile?.();

  await hooks?.beforeUserTrack?.();
  await tx.userTrack.create({
    data: {
      userId,
      trackId: track.id,
    },
  });
  await hooks?.afterUserTrack?.();

  return {
    track: {
      id: track.id,
      title: track.title,
      artistId: track.artistId,
      albumId: track.albumId,
    },
    artistName: artistRecord.name,
    preparedCover,
  };
}

export type CreateLocalUploadParams = Omit<CreateLocalUploadInTransactionParams, "tx">;

export async function createLocalUpload(
  params: CreateLocalUploadParams,
): Promise<CreateLocalUploadInTransactionResult> {
  return prisma.$transaction((tx) => createLocalUploadInTransaction({ ...params, tx }));
}

export function mergeMetadataForLocalUploadBackfill(
  extracted: ExtractedAudioMetadata,
  userMetadata?: LocalUploadUserMetadata,
): ExtractedAudioMetadata {
  if (!userMetadata) return extracted;

  const genreFromUser = userMetadata.genre
    ? userMetadata.genre
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : undefined;

  return {
    ...extracted,
    title: userMetadata.title || extracted.title,
    artist: userMetadata.artist || extracted.artist,
    album: userMetadata.album || extracted.album,
    albumArtist: userMetadata.albumArtist || extracted.albumArtist,
    year: userMetadata.year ?? extracted.year,
    bpm: userMetadata.bpm ?? extracted.bpm,
    label: userMetadata.label || extracted.label,
    isrc: userMetadata.isrc || extracted.isrc,
    originalYear: userMetadata.originalYear ?? extracted.originalYear,
    totalTracks: userMetadata.totalTracks ?? extracted.totalTracks,
    totalDiscs: userMetadata.totalDiscs ?? extracted.totalDiscs,
    lyrics: userMetadata.lyrics || extracted.lyrics,
    releaseDate: userMetadata.releaseDate || extracted.releaseDate,
    originalDate: userMetadata.originalDate || extracted.originalDate,
    genre: genreFromUser ?? extracted.genre,
    track:
      userMetadata.trackNumber !== undefined
        ? { ...(extracted.track ?? {}), no: userMetadata.trackNumber }
        : extracted.track,
  };
}

export function backfillOptionsForLocalUpload(input: {
  userMetadata?: LocalUploadUserMetadata;
  preserveTitle?: boolean;
  preserveArtist?: boolean;
  preserveAlbum?: boolean;
}): BackfillTrackMetadataOptions {
  return {
    preserveTitle: input.preserveTitle ?? Boolean(input.userMetadata?.title),
    preserveArtist: input.preserveArtist ?? Boolean(input.userMetadata?.artist),
    preserveAlbum: input.preserveAlbum ?? Boolean(input.userMetadata?.album),
  };
}

/**
 * Best-effort extended metadata after the ingest transaction commits.
 */
export async function runLocalUploadMetadataBackfill(
  trackId: string,
  extractedMetadata: ExtractedAudioMetadata,
  options: {
    userMetadata?: LocalUploadUserMetadata;
    preserveTitle?: boolean;
    preserveArtist?: boolean;
    preserveAlbum?: boolean;
  } = {},
): Promise<void> {
  const merged = mergeMetadataForLocalUploadBackfill(extractedMetadata, options.userMetadata);
  const backfillOptions = backfillOptionsForLocalUpload(options);
  await backfillTrackMetadata(trackId, merged, backfillOptions);
}
