import { prisma } from "#app/utils/db.server.ts";

export type DispatchVersion = {
  id: string;
  trackId: string;
  videoFileId: string | null;
};
export type GenerationStatus = {
  state: "processing" | "completed" | "failed";
  lines?: unknown;
  text?: string;
  error?: string;
};

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
    throw new Error(
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
    const res = await fetch(`${url}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jobId,
        versionId: version.id,
        trackId: version.trackId,
        videoFileId: version.videoFileId,
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
  });
  if (!res.ok) throw new Error(`Karaoke status failed: HTTP ${res.status}`);
  return (await res.json()) as GenerationStatus;
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
