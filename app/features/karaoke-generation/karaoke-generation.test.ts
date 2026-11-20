import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createTrack } from "#tests/db-utils.ts";
import { dispatchGeneration } from "./dispatch.server.ts";
import { reconcileStuckJobs } from "./reconciler.server.ts";

beforeEach(() => {
  process.env.KARAOKE_GENERATION_MOCKS = "true";
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.KARAOKE_GENERATION_MOCKS;
  delete process.env.KARAOKE_API_URL;
  delete process.env.KARAOKE_API_TOKEN;
});

async function makeJob(
  status = "pending",
  providerJobId: string | null = null,
) {
  const track = await createTrack("T");
  const version = await prisma.trackKaraokeVersion.create({
    data: {
      trackId: track.id,
      language: "en",
      source: "paste",
      lyricsText: "x",
      lines: "[]",
    },
  });
  const job = await prisma.karaokeGenerationJob.create({
    data: { versionId: version.id, status, providerJobId },
  });
  return { version, job };
}

describe("dispatchGeneration", () => {
  test("stub returns a providerJobId and marks the job dispatched", async () => {
    const { version, job } = await makeJob();
    const { providerJobId } = await dispatchGeneration(
      job.id,
      { id: version.id, trackId: version.trackId, videoFileId: null },
      "en",
      "x",
    );
    expect(providerJobId).toBeTruthy();
    expect(
      await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: "dispatched",
      providerJobId,
    });
  });

  test("real path without creds throws a clear error and leaves the job pending", async () => {
    delete process.env.KARAOKE_GENERATION_MOCKS;
    vi.stubEnv("MOCKS", "false");
    const { version, job } = await makeJob();
    await expect(
      dispatchGeneration(
        job.id,
        { id: version.id, trackId: version.trackId, videoFileId: null },
        "en",
        "x",
      ),
    ).rejects.toThrow(/KARAOKE_API_URL/);
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("pending");
  });
});

describe("reconcileStuckJobs", () => {
  test("completes a stuck dispatched job via the status poll", async () => {
    const { version, job } = await makeJob("dispatched", "mock-1");
    await reconcileStuckJobs();
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("completed");
    expect(
      (
        await prisma.trackKaraokeVersion.findUnique({
          where: { id: version.id },
        })
      )?.status,
    ).toBe("draft");
  });

  test("re-dispatches a fresh pending job (no prior failures)", async () => {
    const { job } = await makeJob("pending");
    await reconcileStuckJobs();
    const after = await prisma.karaokeGenerationJob.findUnique({
      where: { id: job.id },
    });
    // dispatched, then the stub poll completes it in the same run
    expect(after?.status).toBe("completed");
    expect(after?.providerJobId).toBeTruthy();
  });

  test("respects backoff for a pending job that recently failed", async () => {
    const { job } = await makeJob("pending");
    await prisma.karaokeGenerationJob.update({
      where: { id: job.id },
      data: { retryCount: 1 },
    });
    await reconcileStuckJobs();
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("pending");
    await prisma.karaokeGenerationJob.update({
      where: { id: job.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60_000) },
    });
    await reconcileStuckJobs();
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("completed");
  });

  test("fails a pending job once the retry cap is reached", async () => {
    const { job } = await makeJob("pending");
    await prisma.karaokeGenerationJob.update({
      where: { id: job.id },
      data: { retryCount: 3 },
    });
    await reconcileStuckJobs();
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("failed");
  });

  test("fails a pending job immediately on a config error", async () => {
    delete process.env.KARAOKE_GENERATION_MOCKS;
    vi.stubEnv("MOCKS", "false");
    const { job } = await makeJob("pending");
    await reconcileStuckJobs();
    const after = await prisma.karaokeGenerationJob.findUnique({
      where: { id: job.id },
    });
    expect(after?.status).toBe("failed");
    expect(after?.errorHistory).toContain("not configured");
  });

  test("skips overlapping runs", async () => {
    const { job } = await makeJob("dispatched", "mock-1");
    await Promise.all([reconcileStuckJobs(), reconcileStuckJobs()]);
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("completed");
  });

  test("an unrecognized provider state is an error, not polled forever", async () => {
    delete process.env.KARAOKE_GENERATION_MOCKS;
    vi.stubEnv("MOCKS", "false");
    process.env.KARAOKE_API_URL = "http://provider.test";
    process.env.KARAOKE_API_TOKEN = "t";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ state: "weird" })),
    );
    const { job } = await makeJob("dispatched", "p-1");
    for (let i = 0; i < 3; i++) await reconcileStuckJobs();
    vi.unstubAllGlobals();
    const after = await prisma.karaokeGenerationJob.findUnique({
      where: { id: job.id },
    });
    expect(after?.status).toBe("failed");
    expect(after?.errorHistory).toContain("unrecognized provider response");
  });
});
