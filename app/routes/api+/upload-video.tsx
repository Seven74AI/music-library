import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MaxFileSizeExceededError, parseFormData } from "@mjackson/form-data-parser";
import { data, type ActionFunctionArgs } from "react-router";
import {
  getMaxVideoUploadBytes,
  ingestTrackVideoFromPath,
  VideoIngestError,
} from "#app/features/track-video/ingest-video.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { VideoUploadTooLargeError } from "#app/utils/storage.server.ts";
import { type Route } from "./+types/upload-video.ts";

function isTooLarge(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (e instanceof MaxFileSizeExceededError || e instanceof VideoUploadTooLargeError) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Authenticated video upload (NOT room-gated). The multipart file is streamed
 * to a temp file (never buffered in memory) under an explicit size cap, then
 * transcoded only if non-compliant and streamed to storage.
 */
export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserId(request);
  const maxBytes = getMaxVideoUploadBytes();

  const workDir = mkdtempSync(join(tmpdir(), "video-upload-"));
  const tmpPath = join(workDir, "upload");
  let uploadedName: string | null = null;

  try {
    let formData: FormData;
    try {
      formData = await parseFormData(request, { maxFileSize: maxBytes }, async (fileUpload) => {
        if (fileUpload.fieldName !== "videoFile") return undefined;
        uploadedName = fileUpload.name || null;
        let size = 0;
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            size += chunk.length;
            if (size > maxBytes) cb(new VideoUploadTooLargeError(maxBytes));
            else cb(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(fileUpload.stream() as never),
          counter,
          createWriteStream(tmpPath),
        );
        return tmpPath;
      });
    } catch (error) {
      if (isTooLarge(error)) {
        return data(
          { success: false, error: `Video exceeds maximum size of ${maxBytes} bytes` },
          { status: 413 },
        );
      }
      return data({ success: false, error: "Invalid upload" }, { status: 400 });
    }

    const trackId = formData.get("trackId");
    if (typeof trackId !== "string" || !trackId) {
      return data({ success: false, error: "trackId is required" }, { status: 400 });
    }
    if (formData.get("videoFile") !== tmpPath) {
      return data({ success: false, error: "Video file is required" }, { status: 400 });
    }

    const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
    if (!track) {
      return data({ success: false, error: "Track not found" }, { status: 404 });
    }

    try {
      const { videoFile, transcoded } = await ingestTrackVideoFromPath({
        trackId,
        inputPath: tmpPath,
        fileName: uploadedName,
      });
      return data({
        success: true,
        transcoded,
        videoFile: {
          id: videoFile.id,
          trackId: videoFile.trackId,
          format: videoFile.format,
          fileSize: videoFile.fileSize,
        },
      });
    } catch (error) {
      if (error instanceof VideoIngestError) {
        const status = error.kind === "track_not_found" ? 404 : 400;
        return data({ success: false, error: error.message }, { status });
      }
      if (error instanceof VideoUploadTooLargeError) {
        return data({ success: false, error: error.message }, { status: 413 });
      }
      throw error;
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
