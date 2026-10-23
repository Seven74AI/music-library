import {
  calculateAudioHash,
  generateAudioFingerprint,
  calculateFingerprintSimilarity,
} from "#app/utils/audio-file-management.server";
import { type ExtractedAudioMetadata } from "#app/utils/audio-metadata.server";
import { prisma } from "#app/utils/db.server.ts";
import { buildAudioObjectKey, uploadFile } from "#app/utils/storage.server";
import { type Prisma } from "#prisma/client.js";
import { backfillTrackMetadata } from "./backfill-track-metadata.server.ts";

/**
 * Number of leading fingerprint characters used as the coarse blocking key for
 * perceptual similarity. Chromaprint fingerprints are base64; 16 characters
 * encode 96 bits, yielding small candidate blocks for any realistic library
 * while still matching re-encodes of the same track (whose fingerprints agree
 * on the leading segment, since the fingerprint is a time-ordered bitstream).
 */
export const FINGERPRINT_BLOCK_PREFIX_LENGTH = 16;

/**
 * Hard cap on the number of candidates compared against a single upload.
 * The coarse-key block already bounds the set; this is defense-in-depth against
 * a pathological block (e.g. the same track re-encoded dozens of times).
 */
export const SIMILARITY_CANDIDATE_CAP = 500;

type UploadProgress = {
  loaded?: number;
  total?: number;
};

export type PersistTrackAudioParams = {
  trackId: string;
  serviceName: string;
  buffer: Buffer;
  metadata: ExtractedAudioMetadata;
  uploadedBy?: string;
  serviceId?: string | null;
  fileName?: string;
  extension?: string;
  storageMetadata?: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
};

export type PersistTrackAudioResult = {
  audioFile: { id: string; trackId: string; objectKey: string };
  objectKey: string;
  created: boolean;
  isDuplicate?: boolean;
  duplicateTrack?: {
    id: string;
    title: string;
    artist: { name: string };
  };
  isSimilar?: boolean;
  similarTrack?: {
    id: string;
    title: string;
    artist: { name: string };
  };
  fingerprintSimilarity?: number;
};

/**
 * Everything needed to create the TrackAudioFile row, produced by
 * {@link prepareTrackAudioUpload} after the (possibly reused) Tigris object
 * has been resolved and — when new — uploaded.
 */
export type PreparedTrackAudio = {
  objectKey: string;
  contentHash: string;
  audioFingerprint: string | null;
  isDuplicate: boolean;
  duplicateTrack?: {
    id: string;
    title: string;
    artist: { name: string };
  };
  isSimilar?: boolean;
  similarTrack?: {
    id: string;
    title: string;
    artist: { name: string };
  };
  fingerprintSimilarity?: number;
};

/** Minimal subset of params needed to create the TrackAudioFile row. */
type CreateTrackAudioFileParams = {
  trackId: string;
  serviceId?: string | null;
  fileName?: string;
  extension?: string;
  metadata: ExtractedAudioMetadata;
  uploadedBy?: string;
  buffer: Buffer;
};

type TrackAudioFileDb = Prisma.TransactionClient | typeof prisma;

function getAudioExtension(
  metadata: ExtractedAudioMetadata,
  fileName?: string,
  extension?: string,
): string {
  if (extension) return extension.replace(/^\./, "").toLowerCase();
  if (fileName) {
    const extFromName = fileName.split(".").pop()?.toLowerCase();
    if (extFromName) return extFromName;
  }
  return metadata.format || "mp3";
}

function runBackfillBestEffort(trackId: string, metadata: ExtractedAudioMetadata): void {
  void backfillTrackMetadata(trackId, metadata).catch((error) => {
    console.error(`Failed to update track metadata from audio file for track ${trackId}:`, error);
  });
}

/**
 * Resolve the Tigris object for a track's audio and upload it when it is new.
 *
 * This performs the content-hash / fingerprint dedup checks and, when the audio
 * is new, uploads it to Tigris. It uses the global `prisma` client and runs
 * entirely OUTSIDE any database transaction, so a slow (or failing) upload never
 * holds a SQLite write lock and can never be rolled back after the object is
 * already in storage. Callers that need the TrackAudioFile row to be created
 * atomically with other writes should call {@link createTrackAudioFile} with the
 * returned {@link PreparedTrackAudio} inside their transaction.
 */
export async function prepareTrackAudioUpload(
  params: PersistTrackAudioParams,
): Promise<PreparedTrackAudio> {
  const {
    trackId,
    serviceName,
    buffer,
    metadata,
    fileName,
    extension: extensionOverride,
    storageMetadata,
    onProgress,
  } = params;

  const extension = getAudioExtension(metadata, fileName, extensionOverride);

  // Step 1: Calculate content hash for deduplication
  const contentHash = await calculateAudioHash(buffer);

  // Step 2: Check if audio with same hash already exists (exact duplicate).
  // Do this BEFORE fingerprint generation — fingerprinting is the CPU-expensive
  // audio analysis, and for an exact duplicate it would be computed and then
  // discarded. Only non-duplicates need a perceptual-similarity fingerprint.
  const existingByHash = await prisma.trackAudioFile.findFirst({
    where: {
      contentHash,
    },
    select: {
      id: true,
      trackId: true,
      objectKey: true,
      track: {
        select: {
          id: true,
          title: true,
          artist: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  // Step 3: Generate audio fingerprint for perceptual similarity (skipped for
  // exact duplicates, which never reach the similarity check below).
  const audioFingerprint = existingByHash ? null : await generateAudioFingerprint(buffer);

  // Step 4: Check for similar audio by fingerprint (if fingerprint was generated)
  let similarByFingerprint: {
    id: string;
    trackId: string;
    audioFingerprint: string | null;
    track: {
      id: string;
      title: string;
      artist: { name: string };
    };
  } | null = null;

  let fingerprintSimilarity = 0;
  const SIMILARITY_THRESHOLD = 0.9; // 90% similarity

  if (audioFingerprint && !existingByHash) {
    // Only check for similar fingerprints if no exact duplicate found.
    //
    // Coarse-key blocking: comparing the new fingerprint against every stored
    // fingerprint is O(N) rows loaded into memory + O(N) CPU per upload, and
    // grows without bound as the library grows. Chromaprint fingerprints are
    // time-ordered bitstreams, so perceptually similar audio (re-encodes,
    // format conversions) shares a long common prefix. Block candidates by the
    // fingerprint prefix so the candidate set stays small and the comparison
    // loop below is bounded.
    const fingerprintBlock = audioFingerprint.slice(0, FINGERPRINT_BLOCK_PREFIX_LENGTH);

    const allFingerprints = await prisma.trackAudioFile.findMany({
      where: {
        audioFingerprint: {
          startsWith: fingerprintBlock,
        },
      },
      take: SIMILARITY_CANDIDATE_CAP,
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        trackId: true,
        audioFingerprint: true,
        track: {
          select: {
            id: true,
            title: true,
            artist: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Find most similar fingerprint
    for (const candidate of allFingerprints) {
      if (!candidate.audioFingerprint) continue;

      const similarity = calculateFingerprintSimilarity(
        audioFingerprint,
        candidate.audioFingerprint,
      );

      if (similarity > fingerprintSimilarity) {
        fingerprintSimilarity = similarity;
        similarByFingerprint = candidate;
      }
    }

    if (fingerprintSimilarity >= SIMILARITY_THRESHOLD && similarByFingerprint) {
      console.warn(
        `⚠️  Similar audio detected for track ${trackId} (${(fingerprintSimilarity * 100).toFixed(1)}% similarity). Similar to track ${similarByFingerprint.trackId}`,
      );
    }
  }

  let objectKey: string;
  let shouldUpload = true;

  if (existingByHash) {
    // Same audio content already exists - reuse the S3 object.
    //
    // The reused objectKey is shared across multiple TrackAudioFile rows (one
    // per track referencing the same audio). Deleting one track must not orphan
    // the other's audio: every S3 deletion goes through
    // `deleteUnreferencedObjectKeys` (app/utils/audio-cleanup.server.ts), which
    // re-counts TrackAudioFile rows by objectKey and only deletes the object
    // once zero rows reference it.
    objectKey = existingByHash.objectKey;
    shouldUpload = false;
    console.warn(
      `⚠️  Duplicate audio detected for track ${trackId}. Reusing existing S3 object from track ${existingByHash.trackId}`,
    );
  } else {
    // New audio - generate new S3 key
    objectKey = buildAudioObjectKey(serviceName, trackId, extension);
  }

  // Step 5: Upload to S3 if this is new audio (outside any DB transaction)
  if (shouldUpload) {
    await uploadFile({
      file: buffer,
      key: objectKey,
      contentType: metadata.mimeType || "audio/mpeg",
      metadata: storageMetadata,
      onProgress,
    });
  } else if (onProgress) {
    // For duplicates, immediately report 100% progress (no upload needed)
    onProgress({ loaded: buffer.length, total: buffer.length });
  }

  // Only include similarity info if we actually checked for it
  const checkedForSimilarity = audioFingerprint && !existingByHash;
  const isSimilar = checkedForSimilarity
    ? fingerprintSimilarity >= SIMILARITY_THRESHOLD && similarByFingerprint !== null
    : undefined;

  return {
    objectKey,
    contentHash,
    audioFingerprint,
    isDuplicate: existingByHash !== null,
    duplicateTrack: existingByHash?.track,
    isSimilar,
    similarTrack: isSimilar ? similarByFingerprint?.track : undefined,
    fingerprintSimilarity: isSimilar ? fingerprintSimilarity : undefined,
  };
}

/**
 * Create the TrackAudioFile row for an already-resolved/uploaded object.
 *
 * This performs only a single fast DB write, so it is safe to call inside a
 * `prisma.$transaction` (pass the transaction client as `db`). The slow upload
 * work must already have happened in {@link prepareTrackAudioUpload}.
 */
export async function createTrackAudioFile(
  params: CreateTrackAudioFileParams,
  prepared: PreparedTrackAudio,
  db: TrackAudioFileDb = prisma,
): Promise<{ id: string; trackId: string; objectKey: string }> {
  const { trackId, serviceId = null, fileName, extension, metadata, uploadedBy, buffer } = params;

  // Resolve serviceId from the track when the caller does not supply one.
  // TrackAudioFile.serviceId is NOT NULL after migration, so a null here would
  // fail the insert (and weaken the (trackId, serviceId, format) uniqueness).
  const resolvedServiceId =
    serviceId ??
    (
      await db.track.findUnique({
        where: { id: trackId },
        select: { serviceId: true },
      })
    )?.serviceId;

  if (!resolvedServiceId) {
    throw new Error(`Cannot persist audio for track ${trackId}: no serviceId on track or params`);
  }

  const format = metadata.format || "mp3";

  // Derive a fallback fileName from this track's own identity rather than the
  // objectKey leaf: on an exact-hash duplicate the objectKey is reused from a
  // different track, so `objectKey.split("/").pop()` would surface the other
  // track's filename. `${trackId}.${ext}` matches the leaf that
  // `buildAudioObjectKey` produces for the non-duplicate path.
  const ext = getAudioExtension(metadata, fileName, extension);
  const fallbackFileName = `${trackId}.${ext}`;

  return db.trackAudioFile.create({
    data: {
      trackId,
      serviceId: resolvedServiceId,
      objectKey: prepared.objectKey,
      contentHash: prepared.contentHash,
      audioFingerprint: prepared.audioFingerprint,
      fileName: fileName ?? fallbackFileName,
      format,
      mimeType: metadata.mimeType || "audio/mpeg",
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
  });
}

/**
 * Persist track audio: upload to Tigris, create TrackAudioFile, then best-effort metadata backfill.
 *
 * Deduplication strategy:
 * - Calculate SHA-256 hash of audio content
 * - If audio with same hash exists, reuse the S3 object (skip upload)
 * - Always create a new TrackAudioFile record for the new track
 * - Return duplicate info so caller can warn user
 *
 * Idempotent when a matching TrackAudioFile already exists (archive retry).
 *
 * This convenience wrapper runs WITHOUT a database transaction. Callers that
 * need to create the TrackAudioFile row atomically with other writes must use
 * {@link prepareTrackAudioUpload} + {@link createTrackAudioFile} instead.
 */
export async function persistTrackAudio(
  params: PersistTrackAudioParams,
): Promise<PersistTrackAudioResult> {
  const { trackId, serviceId = null, metadata } = params;

  const format = metadata.format || "mp3";

  // Resolve serviceId from the track when the caller does not supply one.
  // TrackAudioFile.serviceId is NOT NULL after migration, so a null here would
  // weaken the (trackId, serviceId, format) uniqueness and fail inserts.
  const resolvedServiceId =
    serviceId ??
    (
      await prisma.track.findUnique({
        where: { id: trackId },
        select: { serviceId: true },
      })
    )?.serviceId;

  if (!resolvedServiceId) {
    throw new Error(`Cannot persist audio for track ${trackId}: no serviceId on track or params`);
  }

  // Step 1: Check for existing file by trackId (for archive retry idempotency)
  const existing = await prisma.trackAudioFile.findFirst({
    where: {
      trackId,
      format,
      serviceId: resolvedServiceId,
    },
    select: {
      id: true,
      trackId: true,
      objectKey: true,
    },
  });

  if (existing) {
    runBackfillBestEffort(trackId, metadata);
    return { audioFile: existing, objectKey: existing.objectKey, created: false };
  }

  const prepared = await prepareTrackAudioUpload(params);
  const audioFile = await createTrackAudioFile(params, prepared);

  runBackfillBestEffort(trackId, metadata);

  return {
    audioFile,
    objectKey: prepared.objectKey,
    created: true,
    isDuplicate: prepared.isDuplicate,
    duplicateTrack: prepared.duplicateTrack,
    isSimilar: prepared.isSimilar,
    similarTrack: prepared.similarTrack,
    fingerprintSimilarity: prepared.fingerprintSimilarity,
  };
}
