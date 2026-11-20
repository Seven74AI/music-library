import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_SERVICE } from "#app/constants/services.ts";
import { prisma } from "#app/utils/db.server.ts";
import { buildVideoObjectKey, uploadFileStream } from "#app/utils/storage.server.ts";
import { deleteUnreferencedVideoObjectKeys } from "./video-cleanup.server.ts";
import { isTranscodeCompliant, probeVideo, transcodeToCompliantMp4 } from "./transcode.server.ts";

export const DEFAULT_VIDEO_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

/** Max accepted video size in bytes (env override: VIDEO_UPLOAD_MAX_BYTES). */
export function getMaxVideoUploadBytes(): number {
  const raw = Number(process.env.VIDEO_UPLOAD_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VIDEO_UPLOAD_MAX_BYTES;
}

export class VideoIngestError extends Error {
  constructor(
    message: string,
    public readonly kind: "invalid_media" | "track_not_found" | "service_not_found",
  ) {
    super(message);
    this.name = "VideoIngestError";
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Ingest a local video file for a track: probe → transcode ONLY if not already
 * H.264 + AAC MP4 → stream to storage → upsert the single TrackVideoFile row.
 * The caller owns (and must delete) `inputPath`.
 */
export async function ingestTrackVideoFromPath(params: {
  trackId: string;
  inputPath: string;
  fileName?: string | null;
  serviceName?: string;
}) {
  const { trackId, inputPath, fileName } = params;
  const serviceName = params.serviceName ?? LOCAL_SERVICE.NAME;

  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
  if (!track) throw new VideoIngestError("Track not found", "track_not_found");
  const service = await prisma.service.findUnique({
    where: { name: serviceName },
    select: { id: true },
  });
  if (!service)
    throw new VideoIngestError(`Service '${serviceName}' not found`, "service_not_found");

  let probed;
  try {
    probed = await probeVideo(inputPath);
  } catch {
    throw new VideoIngestError("File is not a readable video", "invalid_media");
  }
  if (!probed.videoCodec) throw new VideoIngestError("File has no video stream", "invalid_media");

  const workDir = mkdtempSync(join(tmpdir(), "video-ingest-"));
  try {
    const transcoded = !isTranscodeCompliant(probed);
    let finalPath = inputPath;
    if (transcoded) {
      finalPath = join(workDir, "transcoded.mp4");
      try {
        await transcodeToCompliantMp4(inputPath, finalPath);
      } catch {
        throw new VideoIngestError("Video could not be transcoded", "invalid_media");
      }
    }

    const size = statSync(finalPath).size;
    const contentHash = await sha256File(finalPath);
    const objectKey = buildVideoObjectKey(serviceName, trackId, "mp4");

    const existing = await prisma.trackVideoFile.findUnique({ where: { trackId } });
    const unchanged = existing?.contentHash === contentHash && existing.objectKey === objectKey;
    if (!unchanged) {
      await uploadFileStream({
        body: createReadStream(finalPath),
        key: objectKey,
        contentType: "video/mp4",
        // Post-transcode output may legitimately differ; cap at the same limit.
        maxBytes: getMaxVideoUploadBytes(),
      });
    }

    const data = {
      serviceId: service.id,
      objectKey,
      contentHash,
      fileName: fileName ?? null,
      fileSize: size,
      mimeType: "video/mp4",
      format: "mp4",
    };
    let videoFile;
    try {
      videoFile = await prisma.trackVideoFile.upsert({
        where: { trackId },
        create: { trackId, ...data },
        update: data,
      });
    } catch (error) {
      if (!existing) await deleteUnreferencedVideoObjectKeys([objectKey]);
      throw error;
    }
    if (existing && existing.objectKey !== objectKey) {
      await deleteUnreferencedVideoObjectKeys([existing.objectKey]);
    }
    return { videoFile, transcoded };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
