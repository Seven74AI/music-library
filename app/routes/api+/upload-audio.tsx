import { parseFormData } from "@mjackson/form-data-parser";
import { createId } from "@paralleldrive/cuid2";
import { data, type ActionFunctionArgs } from "react-router";
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
import { extractAudioMetadata } from "#app/utils/audio-metadata.server";
import {
  prepareCoverImageUpload,
  createCoverImageInTx,
  getOrCreateAlbumTx,
  getOrCreateAlbum,
} from "#app/utils/cover-management.server";
import { prisma } from "#app/utils/db.server";
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

  try {
    // Get file buffer for metadata extraction
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract metadata from audio file
    const extractedMetadata = await extractAudioMetadata(buffer, audioFile.name);

    // Get form data for manual overrides
    const title = formData.get("title")?.toString() || extractedMetadata.title;
    const artist = formData.get("artist")?.toString() || extractedMetadata.artist;
    const album = formData.get("album")?.toString() || extractedMetadata.album;

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
    const preparedAudio = await prepareTrackAudioUpload({
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

    // Log duplicate detection
    if (preparedAudio.isDuplicate && preparedAudio.duplicateTrack) {
      console.warn(
        `⚠️  Duplicate: "${audioFile.name}" has same audio as "${preparedAudio.duplicateTrack.title}" by ${preparedAudio.duplicateTrack.artist.name}`,
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
        extractedMetadata.year || null,
      );
      resolvedAlbumId = resolvedAlbum?.id ?? null;
    }

    // Prepare the cover image OUTSIDE the transaction (sharp + Tigris upload).
    // SQLite serializes writers, so holding the write lock across sharp + a network
    // upload can trip the transaction timeout and roll back DB writes after the
    // object was already uploaded (leaving an orphaned Tigris object).
    let preparedCover: Awaited<ReturnType<typeof prepareCoverImageUpload>> | null = null;
    if (extractedMetadata.coverImage) {
      try {
        preparedCover = await prepareCoverImageUpload({
          imageBuffer: extractedMetadata.coverImage.data,
          albumId: resolvedAlbumId,
          trackId,
          format: extractedMetadata.coverImage.format,
        });
      } catch (error) {
        console.warn(`⚠️  Failed to upload cover image for ${audioFile.name}:`, error);
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
        extractedMetadata.year || null,
      );

      // Associate the cover image (DB-only) — the upload already happened above.
      let coverImageId: string | null = null;
      if (preparedCover) {
        try {
          const coverImage = await createCoverImageInTx(tx, preparedCover, albumRecord?.id ?? null);
          coverImageId = coverImage.id;
        } catch (error) {
          console.warn(`⚠️  Failed to create cover image for ${audioFile.name}:`, error);
          // Continue without cover image
        }
      }

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
          externalId: fileId, // Use fileId as externalId for local uploads
          serviceUrl: null,
          releaseDate: null,
        },
      });

      // Create the TrackAudioFile row (the upload already happened above)
      await createTrackAudioFile(
        {
          trackId: track.id,
          serviceId: localService.id,
          fileName: audioFile.name,
          metadata: extractedMetadata,
          uploadedBy: userId,
          buffer,
        },
        preparedAudio,
        tx,
      );

      // Add track to user's library
      await tx.userTrack.create({
        data: {
          userId,
          trackId: track.id,
        },
      });

      return { track };
    });

    // Fetch artist name for response
    const artistRecord = await prisma.artist.findUnique({
      where: { id: result.track.artistId },
      select: { name: true },
    });

    return data(
      {
        success: true,
        track: {
          id: result.track.id,
          title: result.track.title,
          artist: artistRecord?.name || "Unknown Artist",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error uploading audio file:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to upload audio file";
    return data({ success: false, error: errorMessage }, { status: 500 });
  }
}
