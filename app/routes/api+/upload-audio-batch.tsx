import { parseFormData } from "@mjackson/form-data-parser";
import { createId } from "@paralleldrive/cuid2";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { LOCAL_SERVICE } from "#app/constants/services";
import {
  createLocalUpload,
  runLocalUploadMetadataBackfill,
  type LocalUploadUserMetadata,
} from "#app/features/track-audio-ingest/create-local-upload.server.ts";
import { prepareTrackAudioUpload } from "#app/features/track-audio-ingest/persist-track-audio.server.ts";
import { getOrCreateArtist, extractArtistMetadata } from "#app/utils/artist-management.server";
import {
  extractAudioMetadata,
  type ExtractedAudioMetadata,
} from "#app/utils/audio-metadata.server";
import { getOrCreateAlbum } from "#app/utils/album-management.server";
import {
  prepareCoverImageUpload,
  cleanupFailedCoverUpload,
} from "#app/utils/cover-management.server";
import { cleanupFailedUploadArtifacts } from "#app/utils/audio-cleanup.server.ts";
import { prisma } from "#app/utils/db.server";
import { ROLES } from "#app/utils/permissions.ts";
import { requireUserWithRole } from "#app/utils/permissions.server";
import { extractAudioFilesFromZip } from "#app/utils/zip-extraction.server";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  coerceOptionalInt,
  pickIntField,
  zBatchCoerceRoundedOptionalInt,
} from "#app/utils/track-metadata-int.server.ts";
import {
  UPLOAD_BATCH_FILE_CLIENT_ERROR_MESSAGE,
  UPLOAD_BATCH_METADATA_EXTRACT_CLIENT_ERROR_MESSAGE,
  UPLOAD_BATCH_ZIP_CLIENT_ERROR_MESSAGE,
  toClientErrorMessage,
} from "#app/utils/error-handlers.server";
import {
  initUploadProgress,
  updateFileProgress,
  addSuccessfulTrack,
  addFailedFile,
  removeSuccessfulTrackByTrackId,
  getUploadProgress,
  type SuccessfulTrackInfo,
} from "#app/features/upload-progress/progress-store.server";
import { type Route } from "./+types/upload-audio-batch.ts";

// Maximum file size: 100MB per file, 500MB for ZIP
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_ZIP_SIZE = 500 * 1024 * 1024;

// Allowed audio MIME types
const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/wav",
  "audio/wave",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
];

// Allowed ZIP MIME types
const ALLOWED_ZIP_MIME_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
];

// Maximum concurrency for parallel processing
const MAX_CONCURRENCY = 5;

function audioFileRejection(file: File): string | null {
  if (file.size === 0) {
    return `File ${file.name} is empty`;
  }

  if (file.size > MAX_FILE_SIZE) {
    return `File ${file.name} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`;
  }

  if (!ALLOWED_AUDIO_MIME_TYPES.includes(file.type)) {
    return `File ${file.name} has invalid MIME type: ${file.type}`;
  }

  return null;
}

async function recordFileFailure(uploadId: string, fileId: string, error: string) {
  await updateFileProgress(uploadId, fileId, 0, "failed", error);
  await addFailedFile(uploadId, fileId, error);
}

/**
 * Process items in parallel with a concurrency limit
 * @param items - Array of items to process
 * @param processor - Function to process each item
 * @param concurrency - Maximum number of concurrent operations (default: MAX_CONCURRENCY)
 * @returns Promise that resolves when all items are processed
 */
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = MAX_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex)),
    );
    results.push(...batchResults);
  }

  return results;
}

// Runtime validation for client-supplied per-file metadata. `metadata[i]` is a
// JSON string the client sends alongside each file; without this, a mistyped
// field (non-string title/artist, malformed date) flows into `tx.track.create`
// and `new Date(...)` and fails the whole transaction. (ASVS L1 input validation.)
const dateString = (label: string) =>
  z.string().refine((v) => !Number.isNaN(Date.parse(v)), `${label} must be a valid date`);

const UserMetadataSchema = z.object({
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  genre: z.string().optional(),
  albumArtist: z.string().optional(),
  label: z.string().optional(),
  isrc: z.string().optional(),
  originalDate: dateString("originalDate").optional(),
  releaseDate: dateString("releaseDate").optional(),
  lyrics: z.string().optional(),
  year: zBatchCoerceRoundedOptionalInt(),
  trackNumber: zBatchCoerceRoundedOptionalInt(),
  bpm: zBatchCoerceRoundedOptionalInt(),
  originalYear: zBatchCoerceRoundedOptionalInt(),
  totalTracks: zBatchCoerceRoundedOptionalInt(),
  totalDiscs: zBatchCoerceRoundedOptionalInt(),
});

function roundExtractedNumericMetadata(metadata: ExtractedAudioMetadata): ExtractedAudioMetadata {
  const trackNo = metadata.track?.no;
  const roundedTrackNo = trackNo === undefined ? undefined : coerceOptionalInt(trackNo);
  return {
    ...metadata,
    year: coerceOptionalInt(metadata.year),
    bpm: coerceOptionalInt(metadata.bpm),
    originalYear: coerceOptionalInt(metadata.originalYear),
    totalTracks: coerceOptionalInt(metadata.totalTracks),
    totalDiscs: coerceOptionalInt(metadata.totalDiscs),
    track:
      metadata.track === undefined
        ? undefined
        : {
            ...metadata.track,
            no: roundedTrackNo ?? metadata.track.no,
          },
  };
}

function parseUserMetadata(raw: string | undefined): FileWithMetadata["userMetadata"] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid user metadata JSON");
  }
  const result = UserMetadataSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid user metadata: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  return result.data;
}

interface FileWithMetadata {
  fileName: string;
  /** Index in the original upload so progress ids stay aligned when some files are rejected. */
  sourceIndex: number;
  buffer: Buffer;
  mimeType?: string;
  metadata: ExtractedAudioMetadata;
  userMetadata?: LocalUploadUserMetadata;
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserWithRole(request, ROLES.admin);

  // Parse form data
  const formData = await parseFormData(request, { maxFileSize: MAX_ZIP_SIZE });

  // Get upload session ID or create one
  const uploadId = formData.get("uploadId")?.toString() || createId();

  // Get files - can be single file, multiple files, or ZIP
  const fileInput = formData.get("file");
  const filesInput = formData.getAll("files");
  const zipInput = formData.get("zipFile");

  let filesToProcess: FileWithMetadata[] = [];

  // Handle ZIP file
  if (
    zipInput instanceof File ||
    (fileInput instanceof File &&
      (ALLOWED_ZIP_MIME_TYPES.includes(fileInput.type) ||
        fileInput.name.toLowerCase().endsWith(".zip")))
  ) {
    const zipFile = zipInput instanceof File ? zipInput : (fileInput as File);

    if (zipFile.size > MAX_ZIP_SIZE) {
      return data(
        {
          success: false,
          error: `ZIP file size exceeds maximum of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 },
      );
    }

    try {
      const arrayBuffer = await zipFile.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuffer);
      const extractedFiles = await extractAudioFilesFromZip(zipBuffer);

      // Initialize progress tracking
      await initUploadProgress(
        uploadId,
        extractedFiles.map((f) => f.fileName),
        userId,
      );

      // Extract metadata from each file in parallel (max 5 concurrent)
      await processWithConcurrency(
        extractedFiles,
        async (extractedFile, i) => {
          const fileId = `file-${i}`;

          try {
            await updateFileProgress(uploadId, fileId, 0, "processing");
            let metadata: ExtractedAudioMetadata;
            try {
              metadata = roundExtractedNumericMetadata(
                await extractAudioMetadata(extractedFile.buffer, extractedFile.fileName),
              );
            } catch (error) {
              const message = toClientErrorMessage(
                error,
                UPLOAD_BATCH_METADATA_EXTRACT_CLIENT_ERROR_MESSAGE,
              );
              await recordFileFailure(uploadId, fileId, message);
              console.error(`Error extracting metadata from ${extractedFile.fileName}:`, error);
              return;
            }

            let parsedMetadata: FileWithMetadata["userMetadata"];
            try {
              parsedMetadata = parseUserMetadata(formData.get(`metadata[${i}]`)?.toString());
            } catch (error) {
              const message = error instanceof Error ? error.message : "Invalid user metadata";
              await recordFileFailure(uploadId, fileId, message);
              console.error(`Invalid user metadata for ${extractedFile.fileName}:`, error);
              return;
            }

            filesToProcess.push({
              fileName: extractedFile.fileName,
              sourceIndex: i,
              buffer: extractedFile.buffer,
              mimeType: metadata.mimeType,
              metadata,
              userMetadata: parsedMetadata,
            });
          } catch (error) {
            const message = toClientErrorMessage(
              error,
              UPLOAD_BATCH_METADATA_EXTRACT_CLIENT_ERROR_MESSAGE,
            );
            await recordFileFailure(uploadId, fileId, message);
            console.error(`Error processing ${extractedFile.fileName}:`, error);
          }
        },
        MAX_CONCURRENCY,
      );
    } catch (error) {
      console.error("Failed to extract ZIP file:", error);
      return data(
        {
          success: false,
          error: toClientErrorMessage(error, UPLOAD_BATCH_ZIP_CLIENT_ERROR_MESSAGE),
        },
        { status: 400 },
      );
    }
  } else {
    // Handle single or multiple audio files
    const audioFiles: File[] = [];

    if (fileInput instanceof File) {
      audioFiles.push(fileInput);
    } else if (filesInput.length > 0 && filesInput.every((f) => f instanceof File)) {
      audioFiles.push(...(filesInput as File[]));
    } else {
      return data(
        {
          success: false,
          error: "No file or files provided",
        },
        { status: 400 },
      );
    }

    // Initialize progress for every file, then reject invalid ones individually
    // so one empty or unsupported file does not fail the rest of the batch.
    await initUploadProgress(
      uploadId,
      audioFiles.map((f) => f.name),
      userId,
    );

    await processWithConcurrency(
      audioFiles,
      async (file, i) => {
        const fileId = `file-${i}`;
        const rejection = audioFileRejection(file);
        if (rejection) {
          await recordFileFailure(uploadId, fileId, rejection);
          return;
        }

        try {
          await updateFileProgress(uploadId, fileId, 0, "processing");
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          let metadata: ExtractedAudioMetadata;
          try {
            metadata = roundExtractedNumericMetadata(await extractAudioMetadata(buffer, file.name));
          } catch (error) {
            const message = toClientErrorMessage(
              error,
              UPLOAD_BATCH_METADATA_EXTRACT_CLIENT_ERROR_MESSAGE,
            );
            await recordFileFailure(uploadId, fileId, message);
            console.error(`Error extracting metadata from ${file.name}:`, error);
            return;
          }

          let parsedMetadata: FileWithMetadata["userMetadata"];
          try {
            parsedMetadata = parseUserMetadata(formData.get(`metadata[${i}]`)?.toString());
          } catch (error) {
            const message = error instanceof Error ? error.message : "Invalid user metadata";
            await recordFileFailure(uploadId, fileId, message);
            console.error(`Invalid user metadata for ${file.name}:`, error);
            return;
          }

          filesToProcess.push({
            fileName: file.name,
            sourceIndex: i,
            buffer,
            mimeType: file.type,
            metadata,
            userMetadata: parsedMetadata,
          });
        } catch (error) {
          const message = toClientErrorMessage(
            error,
            UPLOAD_BATCH_METADATA_EXTRACT_CLIENT_ERROR_MESSAGE,
          );
          await recordFileFailure(uploadId, fileId, message);
          console.error(`Error processing ${file.name}:`, error);
        }
      },
      MAX_CONCURRENCY,
    );
  }

  if (filesToProcess.length === 0) {
    const progress = await getUploadProgress(uploadId);
    // Every file was rejected after progress was initialized. Return the
    // session so the client can show those failures and offer a retry.
    if (progress && progress.files.length > 0) {
      return data(
        {
          success: true,
          uploadId,
          message: "Upload started",
        },
        { status: 202 },
      );
    }

    return data(
      {
        success: false,
        error: "No valid audio files to upload",
      },
      { status: 400 },
    );
  }

  // Get or create local service
  const localService = await prisma.service.findUnique({
    where: { name: LOCAL_SERVICE.NAME },
  });

  if (!localService) {
    return data({ success: false, error: "Local service not found" }, { status: 500 });
  }

  // Process files asynchronously (don't await, return upload ID immediately)
  void processFilesAsync(uploadId, filesToProcess, userId, localService.id);

  return data(
    {
      success: true,
      uploadId,
      message: "Upload started",
    },
    { status: 202 }, // Accepted - processing asynchronously
  );
}

/**
 * Process files asynchronously and update progress
 */
async function processFilesAsync(
  uploadId: string,
  files: FileWithMetadata[],
  userId: string,
  serviceId: string,
) {
  // Process files in parallel (max 5 concurrent)
  await processWithConcurrency(
    files,
    async (file): Promise<{ success: boolean; trackId?: string; error?: string }> => {
      const fileId = `file-${file.sourceIndex}`;

      let preparedAudio: Awaited<ReturnType<typeof prepareTrackAudioUpload>> | null = null;
      let preparedCover: Awaited<ReturnType<typeof prepareCoverImageUpload>> | null = null;
      const preparedCoverHolder: {
        current: Awaited<ReturnType<typeof prepareCoverImageUpload>> | null;
      } = { current: null };
      let transactionCommitted = false;
      let trackId: string | undefined;

      try {
        // Use user metadata if provided, otherwise use extracted metadata
        const title = file.userMetadata?.title || file.metadata.title;
        const artist = file.userMetadata?.artist || file.metadata.artist;
        const album = file.userMetadata?.album || file.metadata.album;

        // Validate required fields
        if (!title || !artist) {
          await recordFileFailure(uploadId, fileId, "Title and artist are required");
          return { success: false, error: "Title and artist are required" };
        }

        await updateFileProgress(uploadId, fileId, 5, "uploading", undefined, file.buffer.length);

        // Generate IDs
        trackId = createId();
        const fileIdForStorage = createId();

        await updateFileProgress(uploadId, fileId, 5, "uploading", undefined, file.buffer.length);

        // Upload the audio to Tigris OUTSIDE the database transaction. SQLite
        // serializes writers, so holding the write lock across a network upload
        // made concurrent batches exceed `maxWait` and let a >30s upload trip
        // `timeout`, rolling back the DB writes after the object was already
        // uploaded (leaving an orphaned Tigris object). The transaction below
        // now contains only fast DB writes.
        const uploadStartProgress = 10;
        const uploadEndProgress = 50;
        const uploadProgressRange = uploadEndProgress - uploadStartProgress;

        const audioPrepared = await prepareTrackAudioUpload({
          trackId,
          serviceName: LOCAL_SERVICE.NAME,
          buffer: file.buffer,
          metadata: file.metadata,
          uploadedBy: userId,
          serviceId,
          fileName: file.fileName,
          storageMetadata: {
            title,
            artist,
            album: album || "",
            uploadedBy: userId,
          },
          onProgress: (progress) => {
            if (progress.loaded !== undefined && progress.total && progress.total > 0) {
              const uploadPercentage = (progress.loaded / progress.total) * uploadProgressRange;
              const currentProgress = Math.round(uploadStartProgress + uploadPercentage);
              void updateFileProgress(
                uploadId,
                fileId,
                currentProgress,
                "uploading",
                undefined,
                file.buffer.length,
              );
            }
          },
        });
        preparedAudio = audioPrepared;

        // Log duplicate detection
        if (audioPrepared.isDuplicate && audioPrepared.duplicateTrack) {
          console.warn(
            `⚠️  Duplicate: "${file.fileName}" has same audio as "${audioPrepared.duplicateTrack.title}" by ${audioPrepared.duplicateTrack.artist.name}`,
          );
        }

        // Resolve the album OUTSIDE the transaction so the cover-image dedup check
        // can read its current cover. getOrCreateArtist/getOrCreateAlbum use the
        // global client; the transaction below re-resolves them idempotently.
        const artistMetadata = extractArtistMetadata(file.metadata);
        const albumArtist = file.userMetadata?.albumArtist || file.metadata.albumArtist || artist;
        let resolvedAlbumId: string | null = null;
        if (album) {
          const albumArtistRecord = await getOrCreateArtist(albumArtist, artistMetadata);
          const resolvedAlbum = await getOrCreateAlbum(
            albumArtistRecord.id,
            album,
            pickIntField(file.userMetadata?.year, file.metadata.year),
          );
          resolvedAlbumId = resolvedAlbum?.id ?? null;
        }

        // Prepare the cover image OUTSIDE the transaction (sharp + Tigris upload).
        // SQLite serializes writers, so holding the write lock across sharp + a network
        // upload can trip the transaction timeout and roll back DB writes after the
        // object was already uploaded (leaving an orphaned Tigris object).
        if (file.metadata.coverImage) {
          try {
            preparedCover = await prepareCoverImageUpload({
              imageBuffer: file.metadata.coverImage.data,
              albumId: resolvedAlbumId,
              trackId,
              format: file.metadata.coverImage.format,
            });
            preparedCoverHolder.current = preparedCover;
          } catch (error) {
            await cleanupFailedCoverUpload(error);
            console.warn(`⚠️  Failed to upload cover image for ${file.fileName}:`, error);
            // Continue without cover image
          }
        }

        const uploadResult = await createLocalUpload({
          trackId,
          externalId: fileIdForStorage,
          userId,
          serviceId,
          title,
          artist,
          artistMetadata,
          album: album || null,
          albumArtist,
          yearForAlbum: pickIntField(file.userMetadata?.year, file.metadata.year),
          extractedMetadata: file.metadata,
          preparedCover,
          preparedCoverHolder,
          preparedAudio: audioPrepared,
          audioFileName: file.fileName,
          buffer: file.buffer,
          uploadedBy: userId,
          onCoverPersistFailure: (error) => {
            console.warn(`⚠️  Failed to create cover image for ${file.fileName}:`, error);
          },
          hooks: {
            beforeTrackCreate: () => updateFileProgress(uploadId, fileId, 60, "uploading"),
            afterTrackCreate: () => updateFileProgress(uploadId, fileId, 75, "uploading"),
            afterAudioFile: () => updateFileProgress(uploadId, fileId, 85, "uploading"),
            afterUserTrack: () => updateFileProgress(uploadId, fileId, 95, "uploading"),
          },
        });
        preparedCover = preparedCoverHolder.current ?? uploadResult.preparedCover;
        transactionCommitted = true;

        const successfulTrackInfo: SuccessfulTrackInfo = {
          trackId: uploadResult.track.id,
          fileName: file.fileName,
          title: uploadResult.track.title,
          artist: uploadResult.artistName,
          storageSavedBytes: audioPrepared.isDuplicate ? file.buffer.length : undefined,
          exactDuplicate: audioPrepared.isDuplicate
            ? {
                trackId: audioPrepared.duplicateTrack!.id,
                title: audioPrepared.duplicateTrack!.title,
                artist: audioPrepared.duplicateTrack!.artist.name,
                confidence: 100,
              }
            : undefined,
        };

        const result = {
          success: true as const,
          trackId: uploadResult.track.id,
          successfulTrackInfo,
        };

        try {
          await runLocalUploadMetadataBackfill(uploadResult.track.id, file.metadata, {
            userMetadata: file.userMetadata,
          });
        } catch (backfillError) {
          console.warn(
            `⚠️  Track metadata backfill failed for ${uploadResult.track.id} after batch upload:`,
            backfillError,
          );
        }

        try {
          await addSuccessfulTrack(uploadId, result.successfulTrackInfo);
          await updateFileProgress(
            uploadId,
            fileId,
            100,
            "completed",
            undefined,
            file.buffer.length,
          );
        } catch (progressError) {
          console.warn(
            `Post-commit progress update failed for ${file.fileName} (track ${result.trackId} persisted):`,
            progressError,
          );
          try {
            await addSuccessfulTrack(uploadId, result.successfulTrackInfo);
          } catch {
            // Best-effort: track is already committed.
          }
          try {
            await updateFileProgress(
              uploadId,
              fileId,
              100,
              "completed",
              undefined,
              file.buffer.length,
            );
          } catch {
            // Best-effort: do not surface a committed track as failed.
          }
        }

        return { success: true, trackId: result.trackId };
      } catch (error) {
        preparedCover = preparedCoverHolder.current;
        await cleanupFailedUploadArtifacts(preparedAudio, preparedCover, { transactionCommitted });
        if (transactionCommitted) {
          console.warn(
            `Unexpected error after DB commit for ${file.fileName} (track persisted):`,
            error,
          );
          return { success: true, trackId };
        }

        const errorMessage = toClientErrorMessage(error, UPLOAD_BATCH_FILE_CLIENT_ERROR_MESSAGE);
        if (trackId) {
          await removeSuccessfulTrackByTrackId(uploadId, trackId);
        }
        await updateFileProgress(uploadId, fileId, 0, "failed", errorMessage);
        await addFailedFile(uploadId, fileId, errorMessage);
        console.error(`Error uploading file ${file.fileName}:`, error);

        return { success: false, error: errorMessage };
      }
    },
    MAX_CONCURRENCY,
  );

  // Results are now collected from the parallel processing
  // (kept for potential future use, though not currently used)
}
