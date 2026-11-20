import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createTrack } from "#tests/db-utils.ts";
import { completeGenerationJob } from "./complete-job.server.ts";
import { getFileUrl } from "#app/utils/storage.server.ts";
import { dispatchGeneration, KaraokeConfigError } from "./dispatch.server.ts";
import { reconcileStuckJobs } from "./reconciler.server.ts";

vi.mock("#app/utils/storage.server.ts", async (orig) => ({
  ...(await orig<typeof import("#app/utils/storage.server.ts")>()),
  getFileUrl: vi.fn(async (key: string) => ({
    url: `https://signed.example/${key}`,
    headers: {},
  })),
}));

beforeEach(() => {
  process.env.KARAOKE_GENERATION_MOCKS = "true";
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

describe("completeGenerationJob", () => {
  const LINES = [[{ word: "a", start: 0, end: 1 }]];

  test("writes lines to a draft version and completes the job", async () => {
    const { version, job } = await makeJob("processing");
    expect(await completeGenerationJob(job.id, { lines: LINES })).toEqual({
      applied: true,
    });
    expect(
      (await prisma.trackKaraokeVersion.findUnique({
        where: { id: version.id },
      }))!.lines,
    ).toBe(JSON.stringify(LINES));
  });

  test("no-ops without mutating when the version is already ready", async () => {
    const { version, job } = await makeJob("processing");
    await prisma.trackKaraokeVersion.update({
      where: { id: version.id },
      data: { status: "ready" },
    });
    expect(
      await completeGenerationJob(job.id, { lines: LINES, text: "new" }),
    ).toEqual({ applied: false });
    expect(
      await prisma.trackKaraokeVersion.findUnique({ where: { id: version.id } }),
    ).toMatchObject({ lines: "[]", lyricsText: "x", status: "ready" });
  });
});

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

describe("dispatchGeneration audioUrl handoff", () => {
  async function realPathSetup() {
    delete process.env.KARAOKE_GENERATION_MOCKS;
    vi.stubEnv("MOCKS", "false");
    process.env.KARAOKE_API_URL = "https://modal.example";
    process.env.KARAOKE_API_TOKEN = "tok";
    return makeJob();
  }
  async function addAudio(trackId: string, format: string, objectKey: string) {
    const service = await prisma.service.findFirstOrThrow();
    await prisma.trackAudioFile.create({
      data: { trackId, serviceId: service.id, objectKey, format, mimeType: "audio/x" },
    });
  }

  test("includes a presigned audioUrl of the best audio file (15 min TTL)", async () => {
    const { version, job } = await realPathSetup();
    await addAudio(version.trackId, "zzz-unknown", "audio/other.bin");
    await addAudio(version.trackId, "mp3", "audio/best.mp3");
    const fetchMock = vi.fn(async () => Response.json({ providerJobId: "p1" }));
    vi.stubGlobal("fetch", fetchMock);
    await dispatchGeneration(
      job.id,
      { id: version.id, trackId: version.trackId, videoFileId: "vf1" },
      "en",
      "x",
    );
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as {
      audioUrl: string;
      videoFileId: string;
    };
    expect(body.audioUrl).toBe("https://signed.example/audio/best.mp3");
    expect(body.videoFileId).toBe("vf1");
    expect(getFileUrl).toHaveBeenCalledWith("audio/best.mp3", 900);
  });

  test("missing audio throws KaraokeConfigError without fetch", async () => {
    const { version, job } = await realPathSetup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dispatchGeneration(
        job.id,
        { id: version.id, trackId: version.trackId, videoFileId: null },
        "en",
        "x",
      ),
    ).rejects.toThrow(KaraokeConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reconciler fails a pending job with missing audio immediately", async () => {
    const { job } = await realPathSetup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await reconcileStuckJobs();
    const after = await prisma.karaokeGenerationJob.findUnique({
      where: { id: job.id },
    });
    // other jobs left by earlier tests may be polled; none may be dispatched
    expect(
      fetchMock.mock.calls.some(
        ([u]) => String(u) === "https://modal.example/jobs",
      ),
    ).toBe(false);
    expect(after?.status).toBe("failed");
    expect(after?.retryCount).toBe(1);
    expect(after?.errorHistory).toContain("no audio file");
  });

  test("stub path returns mock-<jobId> and does not sign", async () => {
    vi.mocked(getFileUrl).mockClear();
    const { version, job } = await makeJob();
    const { providerJobId } = await dispatchGeneration(
      job.id,
      { id: version.id, trackId: version.trackId, videoFileId: null },
      "en",
      "x",
    );
    expect(providerJobId).toBe(`mock-${job.id}`);
    expect(getFileUrl).not.toHaveBeenCalled();
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
    const after = await prisma.karaokeGenerationJob.findUnique({
      where: { id: job.id },
    });
    expect(after?.status).toBe("failed");
    expect(after?.errorHistory).toContain("unrecognized provider response");
  });
});
