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
  tx?: Prisma.TransactionClient;
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
 * Persist track audio: upload to Tigris, create TrackAudioFile, then best-effort metadata backfill.
 *
 * Deduplication strategy:
 * - Calculate SHA-256 hash of audio content
 * - If audio with same hash exists, reuse the S3 object (skip upload)
 * - Always create a new TrackAudioFile record for the new track
 * - Return duplicate info so caller can warn user
 *
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
    serviceId,
    fileName,
    extension: extensionOverride,
    storageMetadata,
    onProgress,
    tx,
  } = params;

  const db = tx ?? prisma;
  const format = metadata.format || "mp3";
  const extension = getAudioExtension(metadata, fileName, extensionOverride);

  // Resolve the serviceId from the track when the caller does not supply one
  // (e.g. the archive worker). Track.serviceId is NOT NULL, so every audio file
  // must carry a concrete Service reference — a null here would weaken the
  // (trackId, serviceId, format) unique index (SQLite treats NULLs as distinct).
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

  // Step 1: Check for existing file by trackId (for archive retry idempotency)
  const existing = await db.trackAudioFile.findFirst({
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
    if (!tx) runBackfillBestEffort(trackId, metadata);
    return { audioFile: existing, objectKey: existing.objectKey, created: false };
  }

  // Step 2: Calculate content hash for deduplication
  const contentHash = await calculateAudioHash(buffer);

  // Step 3: Generate audio fingerprint for perceptual similarity
  const audioFingerprint = await generateAudioFingerprint(buffer);

  // Step 4: Check if audio with same hash already exists (exact duplicate)
  const existingByHash = await db.trackAudioFile.findFirst({
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

  // Step 5: Check for similar audio by fingerprint (if fingerprint was generated)
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
    const allFingerprints = await db.trackAudioFile.findMany({
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

  // Step 6: Upload to S3 if this is new audio
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

  // Step 7: Create new TrackAudioFile record (even for duplicates, to link this track)
  const audioFile = await db.trackAudioFile.create({
    data: {
      trackId,
      serviceId: resolvedServiceId,
      objectKey,
      contentHash,
      audioFingerprint,
      fileName: fileName ?? objectKey.split("/").pop(),
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

  if (!tx) runBackfillBestEffort(trackId, metadata);

  // Only include similarity info if we actually checked for it
  const checkedForSimilarity = audioFingerprint && !existingByHash;
  const isSimilar = checkedForSimilarity
    ? fingerprintSimilarity >= SIMILARITY_THRESHOLD && similarByFingerprint !== null
    : undefined;

  return {
    audioFile,
    objectKey,
    created: true,
    isDuplicate: existingByHash !== null,
    duplicateTrack: existingByHash?.track,
    isSimilar,
    similarTrack: isSimilar ? similarByFingerprint?.track : undefined,
    fingerprintSimilarity: isSimilar ? fingerprintSimilarity : undefined,
  };
}
