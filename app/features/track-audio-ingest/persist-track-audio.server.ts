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

  // Step 2: Generate audio fingerprint for perceptual similarity
  const audioFingerprint = await generateAudioFingerprint(buffer);

  // Step 3: Check if audio with same hash already exists (exact duplicate)
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
    // Only check for similar fingerprints if no exact duplicate found
    const allFingerprints = await prisma.trackAudioFile.findMany({
      where: {
        audioFingerprint: {
          not: null,
        },
      },
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
    // Same audio content already exists - reuse the S3 object
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
  const { trackId, serviceId = null, fileName, metadata, uploadedBy, buffer } = params;

  const format = metadata.format || "mp3";

  return db.trackAudioFile.create({
    data: {
      trackId,
      serviceId,
      objectKey: prepared.objectKey,
      contentHash: prepared.contentHash,
      audioFingerprint: prepared.audioFingerprint,
      fileName: fileName ?? prepared.objectKey.split("/").pop(),
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

  // Step 1: Check for existing file by trackId (for archive retry idempotency)
  const existing = await prisma.trackAudioFile.findFirst({
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
