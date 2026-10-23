import { parseFormData } from "@mjackson/form-data-parser";
import { createId } from "@paralleldrive/cuid2";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { LOCAL_SERVICE } from "#app/constants/services";
import {
  prepareTrackAudioUpload,
  createTrackAudioFile,
} from "#app/features/track-audio-ingest/persist-track-audio.server.ts";
import {
  getOrCreateArtistTx,
  getOrCreateArtist,
  extractArtistMetadata,
} from "#app/utils/artist-management.server";
import {
  extractAudioMetadata,
  type ExtractedAudioMetadata,
} from "#app/utils/audio-metadata.server";
import {
  prepareCoverImageUpload,
  createCoverImageInTx,
  getOrCreateAlbumTx,
  getOrCreateAlbum,
} from "#app/utils/cover-management.server";
import { prisma } from "#app/utils/db.server";
import { requireUserWithRole } from "#app/utils/permissions.server";
import { extractAudioFilesFromZip } from "#app/utils/zip-extraction.server";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  initUploadProgress,
  updateFileProgress,
  addSuccessfulTrack,
  addFailedFile,
  getUploadProgress,
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
  year: z.coerce.number().optional(),
  trackNumber: z.coerce.number().optional(),
  bpm: z.coerce.number().optional(),
  originalYear: z.coerce.number().optional(),
  totalTracks: z.coerce.number().optional(),
  totalDiscs: z.coerce.number().optional(),
});

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
    throw new Error(`Invalid user metadata: ${result.error.issues.map((i) => i.message).join(", ")}`);
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
  userMetadata?: {
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
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserWithRole(request, "admin");

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
      );

      // Extract metadata from each file in parallel (max 5 concurrent)
      await processWithConcurrency(
        extractedFiles,
        async (extractedFile, i) => {
          const fileId = `file-${i}`;

          try {
            await updateFileProgress(uploadId, fileId, 0, "processing");
            const metadata = await extractAudioMetadata(
              extractedFile.buffer,
              extractedFile.fileName,
            );

            // Get user-provided metadata for this file (if any)
            const parsedMetadata = parseUserMetadata(formData.get(`metadata[${i}]`)?.toString());

            filesToProcess.push({
              fileName: extractedFile.fileName,
              sourceIndex: i,
              buffer: extractedFile.buffer,
              mimeType: metadata.mimeType,
              metadata,
              userMetadata: parsedMetadata,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to extract metadata";
            await recordFileFailure(uploadId, fileId, message);
            console.error(`Error extracting metadata from ${extractedFile.fileName}:`, error);
          }
        },
        MAX_CONCURRENCY,
      );
    } catch (error) {
      return data(
        {
          success: false,
          error: `Failed to extract ZIP file: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          const metadata = await extractAudioMetadata(buffer, file.name);

          // Get user-provided metadata for this file (if any)
          const parsedMetadata = parseUserMetadata(formData.get(`metadata[${i}]`)?.toString());

          filesToProcess.push({
            fileName: file.name,
            sourceIndex: i,
            buffer,
            mimeType: file.type,
            metadata,
            userMetadata: parsedMetadata,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to extract metadata";
          await recordFileFailure(uploadId, fileId, message);
          console.error(`Error extracting metadata from ${file.name}:`, error);
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
        const trackId = createId();
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

        const preparedAudio = await prepareTrackAudioUpload({
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

        // Log duplicate detection
        if (preparedAudio.isDuplicate && preparedAudio.duplicateTrack) {
          console.warn(
            `⚠️  Duplicate: "${file.fileName}" has same audio as "${preparedAudio.duplicateTrack.title}" by ${preparedAudio.duplicateTrack.artist.name}`,
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
            file.userMetadata?.year || file.metadata.year || null,
          );
          resolvedAlbumId = resolvedAlbum?.id ?? null;
        }

        // Prepare the cover image OUTSIDE the transaction (sharp + Tigris upload).
        // SQLite serializes writers, so holding the write lock across sharp + a network
        // upload can trip the transaction timeout and roll back DB writes after the
        // object was already uploaded (leaving an orphaned Tigris object).
        let preparedCover: Awaited<ReturnType<typeof prepareCoverImageUpload>> | null = null;
        if (file.metadata.coverImage) {
          try {
            preparedCover = await prepareCoverImageUpload({
              imageBuffer: file.metadata.coverImage.data,
              albumId: resolvedAlbumId,
              trackId,
              format: file.metadata.coverImage.format,
            });
          } catch (error) {
            console.warn(`⚠️  Failed to upload cover image for ${file.fileName}:`, error);
            // Continue without cover image
          }
        }

        // Create track and TrackAudioFile rows in a short transaction
        const result = await prisma.$transaction(async (tx) => {
          // Get or create artist
          const artistRecord = await getOrCreateArtistTx(tx, artist, artistMetadata);

          // Get or create album (using artistId)
          const albumArtistRecord = await getOrCreateArtistTx(tx, albumArtist, artistMetadata);
          const albumRecord = await getOrCreateAlbumTx(
            tx,
            albumArtistRecord.id,
            album || null,
            file.userMetadata?.year || file.metadata.year || null,
          );

          // Associate the cover image (DB-only) — the upload already happened above.
          let coverImageId: string | null = null;
          if (preparedCover) {
            try {
              const coverImage = await createCoverImageInTx(
                tx,
                preparedCover,
                albumRecord?.id ?? null,
              );
              coverImageId = coverImage.id;
            } catch (error) {
              console.warn(`⚠️  Failed to create cover image for ${file.fileName}:`, error);
              // Continue without cover image
            }
          }

          // Create track with all metadata fields
          await updateFileProgress(uploadId, fileId, 60, "uploading");
          const track = await tx.track.create({
            data: {
              id: trackId,
              title,
              artistId: artistRecord.id,
              albumId: albumRecord?.id || null,
              coverImageId,
              duration: file.metadata.duration || null,
              serviceId: serviceId,
              externalId: fileIdForStorage,
              serviceUrl: null,
              releaseDate: file.userMetadata?.releaseDate
                ? new Date(file.userMetadata.releaseDate)
                : file.metadata.releaseDate
                  ? new Date(file.metadata.releaseDate)
                  : null,
              // Basic metadata
              genre: file.userMetadata?.genre || file.metadata.genre?.[0] || null,
              year: file.userMetadata?.year || file.metadata.year || null,
              trackNumber: file.userMetadata?.trackNumber || file.metadata.track?.no || null,
              albumArtist: file.userMetadata?.albumArtist || file.metadata.albumArtist || null,
              // Additional metadata
              bpm: file.userMetadata?.bpm || file.metadata.bpm || null,
              label: file.userMetadata?.label || file.metadata.label || null,
              isrc: file.userMetadata?.isrc || file.metadata.isrc || null,
              originalDate: file.userMetadata?.originalDate
                ? new Date(file.userMetadata.originalDate)
                : file.metadata.originalDate
                  ? new Date(file.metadata.originalDate)
                  : null,
              originalYear: file.userMetadata?.originalYear || file.metadata.originalYear || null,
              totalTracks: file.userMetadata?.totalTracks || file.metadata.totalTracks || null,
              totalDiscs: file.userMetadata?.totalDiscs || file.metadata.totalDiscs || null,
              lyrics: file.userMetadata?.lyrics || file.metadata.lyrics || null,
            },
          });

          await updateFileProgress(uploadId, fileId, 75, "uploading");

          // Create the TrackAudioFile row (the upload already happened above)
          await createTrackAudioFile(
            {
              trackId: track.id,
              serviceId,
              fileName: file.fileName,
              metadata: file.metadata,
              uploadedBy: userId,
              buffer: file.buffer,
            },
            preparedAudio,
            tx,
          );

          await updateFileProgress(uploadId, fileId, 85, "uploading");

          // Add track to user's library
          await tx.userTrack.create({
            data: {
              userId,
              trackId: track.id,
            },
          });

          await updateFileProgress(uploadId, fileId, 95, "uploading");

          // Store successful track information
          await addSuccessfulTrack(uploadId, {
            trackId: track.id,
            fileName: file.fileName,
            title: track.title,
            artist: artistRecord.name,
            storageSavedBytes: preparedAudio.isDuplicate ? file.buffer.length : undefined,
            exactDuplicate: preparedAudio.isDuplicate
              ? {
                  trackId: preparedAudio.duplicateTrack!.id,
                  title: preparedAudio.duplicateTrack!.title,
                  artist: preparedAudio.duplicateTrack!.artist.name,
                  confidence: 100, // Content hash match is 100% confidence
                }
              : undefined,
          });

          return { success: true, trackId: track.id };
        });

        // Update to 100% after transaction completes successfully
        await updateFileProgress(uploadId, fileId, 100, "completed", undefined, file.buffer.length);

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to upload file";
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
