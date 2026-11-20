import { z } from "zod";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getFileUrl } from "#app/utils/storage.server.ts";

export type DispatchVersion = {
  id: string;
  trackId: string;
  videoFileId: string | null;
};
const FETCH_TIMEOUT_MS = 15_000;
/** Presigned audio URL lifetime handed to the provider. */
const AUDIO_URL_TTL_SECONDS = 15 * 60;

/** Permanent errors where retrying can't help — missing provider config, or missing track audio. */
export class KaraokeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KaraokeConfigError";
  }
}

const GenerationStatusSchema = z.object({
  state: z.enum(["processing", "completed", "failed"]),
  lines: z.unknown().optional(),
  text: z.string().optional(),
  error: z.string().optional(),
});
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export function isKaraokeGenerationStubbed(): boolean {
  return (
    process.env.KARAOKE_GENERATION_MOCKS === "true" ||
    (process.env.MOCKS === "true" && !process.env.KARAOKE_API_URL)
  );
}

function apiConfig() {
  const url = process.env.KARAOKE_API_URL;
  const token = process.env.KARAOKE_API_TOKEN;
  if (!url || !token) {
    throw new KaraokeConfigError(
      "Karaoke generation is not configured: set KARAOKE_API_URL and KARAOKE_API_TOKEN (or KARAOKE_GENERATION_MOCKS=true)",
    );
  }
  return { url: url.replace(/\/$/, ""), token };
}

/**
 * Dispatch a generation job to the GPU provider (Modal). On success the job is
 * stored as `dispatched` with its `providerJobId`. Stubbed when mocks are on.
 */
export async function dispatchGeneration(
  jobId: string,
  version: DispatchVersion,
  language: string,
  text: string | null,
): Promise<{ providerJobId: string }> {
  let providerJobId: string;
  if (isKaraokeGenerationStubbed()) {
    providerJobId = `mock-${jobId}`;
  } else {
    const { url, token } = apiConfig();
    // Word times must align to the track's audio (the room's only clock), so
    // hand the provider a short-lived URL for the same file the stream route picks.
    const audioFiles = await prisma.trackAudioFile.findMany({
      where: { trackId: version.trackId },
      select: { format: true, objectKey: true },
    });
    const audioFile = selectBestAudioFile(audioFiles);
    if (!audioFile?.objectKey) {
      throw new KaraokeConfigError(
        `Karaoke dispatch failed: track ${version.trackId} has no audio file`,
      );
    }
    const { url: audioUrl } = await getFileUrl(
      audioFile.objectKey,
      AUDIO_URL_TTL_SECONDS,
    );
    const res = await fetch(`${url}/jobs`, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jobId,
        versionId: version.id,
        trackId: version.trackId,
        videoFileId: version.videoFileId,
        audioUrl,
        language,
        text,
      }),
    });
    if (!res.ok) throw new Error(`Karaoke dispatch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { providerJobId?: unknown };
    if (typeof body.providerJobId !== "string" || !body.providerJobId) {
      throw new Error("Karaoke dispatch failed: missing providerJobId");
    }
    providerJobId = body.providerJobId;
  }
  await prisma.karaokeGenerationJob.update({
    where: { id: jobId },
    data: { status: "dispatched", providerJobId },
  });
  return { providerJobId };
}

/** Poll the provider for a job's state (reconciler fallback). Stub returns a terminal state. */
export async function getGenerationStatus(
  providerJobId: string,
): Promise<GenerationStatus> {
  if (isKaraokeGenerationStubbed()) {
    return { state: "completed", lines: [] };
  }
  const { url, token } = apiConfig();
  const res = await fetch(`${url}/jobs/${encodeURIComponent(providerJobId)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Karaoke status failed: HTTP ${res.status}`);
  const parsed = GenerationStatusSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Karaoke status failed: unrecognized provider response");
  }
  return parsed.data;
}

/** Re-dispatch a job that is still `pending` (initial dispatch failed). */
export async function redispatchPendingJob(jobId: string): Promise<void> {
  const job = await prisma.karaokeGenerationJob.findUnique({
    where: { id: jobId },
    include: { version: true },
  });
  if (!job || job.status !== "pending") return;
  const { version } = job;
  await dispatchGeneration(
    job.id,
    { id: version.id, trackId: version.trackId, videoFileId: version.videoFileId },
    version.language,
    version.source === "whisper" ? null : version.lyricsText,
  );
}

/** Append to the job's errorHistory JSON array and bump retryCount; optionally fail the job. */
export async function recordJobError(
  jobId: string,
  error: unknown,
  fail = false,
) {
  const job = await prisma.karaokeGenerationJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;
  let history: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(job.errorHistory);
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    // corrupt history: start over
  }
  history.push({
    at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  });
  await prisma.karaokeGenerationJob.update({
    where: { id: jobId },
    data: {
      errorHistory: JSON.stringify(history),
      retryCount: { increment: 1 },
      ...(fail ? { status: "failed" } : {}),
    },
  });
}
