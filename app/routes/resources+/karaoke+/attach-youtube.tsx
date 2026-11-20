import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { isAllowedArchiveDownloadUrl } from "#app/features/audio-archive/yt-dlp.server.ts";
import { getCookieFilePath } from "#app/features/audio-archive/youtube-cookie.server.ts";
import {
  getMaxVideoUploadBytes,
  ingestTrackVideoFromPath,
  VideoIngestError,
} from "#app/features/track-video/ingest-video.server.ts";
import { fetchYoutubeVideo } from "#app/features/track-video/youtube-video.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";

export const AttachYoutubeSchema = z.object({
  trackId: z.string().min(1),
  url: z.string().min(1),
});

/**
 * Authenticated, manual per-track YouTube video attach. The URL is checked
 * with the audio-archive SSRF guard (canonical watch URLs only) before any
 * download; the result goes through the same ingest path as upload-video.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireUserId(request);
  const parsed = AttachYoutubeSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data({ success: false, error: "trackId and url are required" }, { status: 400 });
  }
  const { trackId, url } = parsed.data;
  if (!isAllowedArchiveDownloadUrl(url)) {
    return data(
      { success: false, error: "Only canonical https://www.youtube.com/watch?v=… URLs are allowed" },
      { status: 400 },
    );
  }
  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
  if (!track) return data({ success: false, error: "Track not found" }, { status: 404 });

  const workDir = mkdtempSync(join(tmpdir(), "yt-video-"));
  try {
    const cookieFile = getCookieFilePath();
    const fetched = await fetchYoutubeVideo(url, {
      outputDir: workDir,
      maxBytes: getMaxVideoUploadBytes(),
      cookieFile: existsSync(cookieFile) ? cookieFile : undefined,
    });
    if (!fetched.ok) {
      return data(
        {
          success: false,
          error: "Could not fetch the YouTube video. Please upload the video file instead.",
        },
        { status: 502 },
      );
    }
    try {
      const { videoFile, transcoded } = await ingestTrackVideoFromPath({
        trackId,
        inputPath: fetched.filePath,
        fileName: null,
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
        return data(
          { success: false, error: error.message },
          { status: error.kind === "track_not_found" ? 404 : 400 },
        );
      }
      throw error;
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
