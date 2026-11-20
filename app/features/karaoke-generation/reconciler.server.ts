import { prisma } from "#app/utils/db.server.ts";
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import { completeGenerationJob } from "./complete-job.server.ts";
import {
  getGenerationStatus,
  KaraokeConfigError,
  recordJobError,
  redispatchPendingJob,
} from "./dispatch.server.ts";

const MAX_RETRIES = 3;
let handle: ReturnType<typeof setInterval> | null = null;

const PENDING_BACKOFF_BASE_MS = 30_000;
let running = false;

/** Re-dispatch `pending` jobs (failed initial dispatch) with exponential backoff and a retry cap. */
async function redispatchPendingJobs(): Promise<void> {
  const pending = await prisma.karaokeGenerationJob.findMany({
    where: { status: "pending" },
  });
  for (const job of pending) {
    if (job.retryCount >= MAX_RETRIES) {
      await recordJobError(job.id, "dispatch retries exhausted", true);
      continue;
    }
    const dueAt =
      job.updatedAt.getTime() + PENDING_BACKOFF_BASE_MS * 2 ** job.retryCount;
    if (job.retryCount > 0 && Date.now() < dueAt) continue;
    try {
      await redispatchPendingJob(job.id);
    } catch (error) {
      await recordJobError(
        job.id,
        error,
        error instanceof KaraokeConfigError ||
          job.retryCount + 1 >= MAX_RETRIES,
      );
    }
  }
}

/** Poll the provider for stuck dispatched/processing jobs and reconcile them. */
export async function reconcileStuckJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await redispatchPendingJobs();
    await reconcileProviderJobs();
  } finally {
    running = false;
  }
}

async function reconcileProviderJobs(): Promise<void> {
  const jobs = await prisma.karaokeGenerationJob.findMany({
    where: {
      status: { in: ["dispatched", "processing"] },
      providerJobId: { not: null },
    },
  });
  for (const job of jobs) {
    try {
      const status = await getGenerationStatus(job.providerJobId!);
      if (status.state === "completed") {
        await completeGenerationJob(job.id, {
          lines: status.lines,
          text: status.text,
        });
      } else if (status.state === "failed") {
        await recordJobError(
          job.id,
          status.error ?? "provider reported failure",
          true,
        );
      } else if (job.status !== "processing") {
        await prisma.karaokeGenerationJob.update({
          where: { id: job.id },
          data: { status: "processing" },
        });
      }
    } catch (error) {
      await recordJobError(job.id, error, job.retryCount + 1 >= MAX_RETRIES);
    }
  }
}

export function startKaraokeReconciler(intervalMs = 60_000): void {
  if (process.env.KARAOKE_GENERATION_ENABLED !== "true") return;
  if (handle !== null) return;
  const tick = () => {
    void (async () => {
      const { currentIsPrimary } = await getInstanceInfo();
      if (!currentIsPrimary) return;
      await reconcileStuckJobs();
    })().catch((error) =>
      console.error("Karaoke reconciler tick failed", error),
    );
  };
  tick();
  handle = setInterval(tick, intervalMs);
  console.log(`Karaoke reconciler started (interval: ${intervalMs}ms)`);
}

export function stopKaraokeReconciler(): void {
  if (handle !== null) {
    clearInterval(handle);
    handle = null;
  }
}
