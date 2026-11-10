import { parseFormData } from "@mjackson/form-data-parser";
import { createId } from "@paralleldrive/cuid2";
import { data, type ActionFunctionArgs } from "react-router";
import { LOCAL_SERVICE } from "#app/constants/services";
import {
  createLocalUpload,
  runLocalUploadMetadataBackfill,
} from "#app/features/track-audio-ingest/create-local-upload.server.ts";
import { prepareTrackAudioUpload } from "#app/features/track-audio-ingest/persist-track-audio.server.ts";
import { getOrCreateArtist, extractArtistMetadata } from "#app/utils/artist-management.server";
import { extractAudioMetadata } from "#app/utils/audio-metadata.server";
import { getOrCreateAlbum } from "#app/utils/album-management.server";
import {
  prepareCoverImageUpload,
  cleanupFailedCoverUpload,
} from "#app/utils/cover-management.server";
import { cleanupFailedUploadArtifacts } from "#app/utils/audio-cleanup.server.ts";
import { prisma } from "#app/utils/db.server";
import { pickIntField } from "#app/utils/track-metadata-int.server.ts";
import {
  UPLOAD_AUDIO_CLIENT_ERROR_MESSAGE,
  toClientErrorMessage,
} from "#app/utils/error-handlers.server";
import { requireUserWithRole } from "#app/utils/permissions.server";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/upload-audio.ts";

// Maximum file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Allowed audio MIME types
const ALLOWED_MIME_TYPES = [
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

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserWithRole(request, "admin");

  // Parse form data with file size limit
  const formData = await parseFormData(request, { maxFileSize: MAX_FILE_SIZE });

  // Validate file
  const audioFile = formData.get("audioFile");
  if (!(audioFile instanceof File)) {
    return data({ success: false, error: "Audio file is required" }, { status: 400 });
  }

  if (audioFile.size === 0) {
    return data({ success: false, error: "Audio file is empty" }, { status: 400 });
  }

  // Validate file size
  if (audioFile.size > MAX_FILE_SIZE) {
    return data(
      {
        success: false,
        error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      },
      { status: 400 },
    );
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(audioFile.type)) {
    return data(
      {
        success: false,
        error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  let preparedAudio: Awaited<ReturnType<typeof prepareTrackAudioUpload>> | null = null;
  let preparedCover: Awaited<ReturnType<typeof prepareCoverImageUpload>> | null = null;
  const preparedCoverHolder: {
    current: Awaited<ReturnType<typeof prepareCoverImageUpload>> | null;
  } = { current: null };
  let transactionCommitted = false;

  try {
    // Get file buffer for metadata extraction
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract metadata from audio file
    const extractedMetadata = await extractAudioMetadata(buffer, audioFile.name);

    // Get form data for manual overrides
    const formTitle = formData.get("title")?.toString();
    const formArtist = formData.get("artist")?.toString();
    const formAlbum = formData.get("album")?.toString();
    const title = formTitle || extractedMetadata.title;
    const artist = formArtist || extractedMetadata.artist;
    const album = formAlbum || extractedMetadata.album;

    // Validate required fields
    if (!title || !artist) {
      return data(
        {
          success: false,
          error: "Title and artist are required (extract from file or provide manually)",
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

    // Generate track ID
    const trackId = createId();
    const fileId = createId();

    // Upload the audio to Tigris OUTSIDE the database transaction. SQLite
    // serializes writers, so holding the write lock across a network upload can
    // trip the transaction timeout and roll back the DB writes after the object
    // was already uploaded (leaving an orphaned Tigris object). The transaction
    // below now contains only fast DB writes.
    const audioPrepared = await prepareTrackAudioUpload({
      trackId,
      serviceName: LOCAL_SERVICE.NAME,
      buffer,
      metadata: extractedMetadata,
      uploadedBy: userId,
      serviceId: localService.id,
      fileName: audioFile.name,
      storageMetadata: {
        title,
        artist,
        album: album || "",
        uploadedBy: userId,
      },
    });
    preparedAudio = audioPrepared;

    // Log duplicate detection
    if (audioPrepared.isDuplicate && audioPrepared.duplicateTrack) {
      console.warn(
        `⚠️  Duplicate: "${audioFile.name}" has same audio as "${audioPrepared.duplicateTrack.title}" by ${audioPrepared.duplicateTrack.artist.name}`,
      );
    }

    const artistMetadata = extractArtistMetadata(extractedMetadata);
    const albumArtist = extractedMetadata.albumArtist || artist;

    // Resolve the album OUTSIDE the transaction so the cover-image dedup check can
    // read its current cover. getOrCreateArtist/getOrCreateAlbum use the global
    // client; the transaction below re-resolves them idempotently.
    let resolvedAlbumId: string | null = null;
    if (album) {
      const albumArtistRecord = await getOrCreateArtist(albumArtist, artistMetadata);
      const resolvedAlbum = await getOrCreateAlbum(
        albumArtistRecord.id,
        album,
        pickIntField(extractedMetadata.year),
      );
      resolvedAlbumId = resolvedAlbum?.id ?? null;
    }

    // Prepare the cover image OUTSIDE the transaction (sharp + Tigris upload).
    // SQLite serializes writers, so holding the write lock across sharp + a network
    // upload can trip the transaction timeout and roll back DB writes after the
    // object was already uploaded (leaving an orphaned Tigris object).
    if (extractedMetadata.coverImage) {
      try {
        preparedCover = await prepareCoverImageUpload({
          imageBuffer: extractedMetadata.coverImage.data,
          albumId: resolvedAlbumId,
          trackId,
          format: extractedMetadata.coverImage.format,
        });
        preparedCoverHolder.current = preparedCover;
      } catch (error) {
        await cleanupFailedCoverUpload(error);
        console.warn(`⚠️  Failed to upload cover image for ${audioFile.name}:`, error);
        // Continue without cover image
      }
    }

    const result = await createLocalUpload({
      trackId,
      externalId: fileId,
      userId,
      serviceId: localService.id,
      title,
      artist,
      artistMetadata,
      album: album || null,
      albumArtist,
      yearForAlbum: pickIntField(extractedMetadata.year),
      extractedMetadata,
      preparedCover,
      preparedCoverHolder,
      preparedAudio: audioPrepared,
      audioFileName: audioFile.name,
      buffer,
      uploadedBy: userId,
      onCoverPersistFailure: (error) => {
        console.warn(`⚠️  Failed to create cover image for ${audioFile.name}:`, error);
      },
    });
    preparedCover = preparedCoverHolder.current ?? result.preparedCover;
    transactionCommitted = true;

    try {
      await runLocalUploadMetadataBackfill(result.track.id, extractedMetadata, {
        preserveTitle: Boolean(formTitle),
        preserveArtist: Boolean(formArtist),
        preserveAlbum: Boolean(formAlbum),
      });
    } catch (backfillError) {
      console.warn(
        `⚠️  Track metadata backfill failed for ${result.track.id} after upload:`,
        backfillError,
      );
    }

    return data(
      {
        success: true,
        track: {
          id: result.track.id,
          title: result.track.title,
          artist: result.artistName || "Unknown Artist",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    preparedCover = preparedCoverHolder.current;
    await cleanupFailedUploadArtifacts(preparedAudio, preparedCover, { transactionCommitted });
    console.error("Error uploading audio file:", error);
    return data(
      { success: false, error: toClientErrorMessage(error, UPLOAD_AUDIO_CLIENT_ERROR_MESSAGE) },
      { status: 500 },
    );
  }
}
