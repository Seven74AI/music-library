import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock prisma
const mockPrisma = {
  archiveJob: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  },
  track: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  artist: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  album: {
    upsert: vi.fn(),
  },
  workerState: {
    upsert: vi.fn(),
  },
  trackAudioFile: {
    create: vi.fn(),
  },
  youtubeCookie: {
    updateMany: vi.fn(),
  },
  $disconnect: vi.fn().mockResolvedValue(undefined),
};

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: mockPrisma,
}));

// Mock yt-dlp execution. Keep the real URL and path guards.
const mockExecuteYtDlp = vi.fn();
vi.mock("./yt-dlp.server", async () => {
  const actual = await vi.importActual<typeof import("./yt-dlp.server.ts")>("./yt-dlp.server.ts");
  return {
    ...actual,
    executeYtDlp: mockExecuteYtDlp,
  };
});

// Mock track audio ingest
const mockPersistTrackAudio = vi.fn();
vi.mock("#app/features/track-audio-ingest/persist-track-audio.server.ts", () => ({
  persistTrackAudio: mockPersistTrackAudio,
}));

// Mock worker control
const mockIsWorkerActive = vi.fn();
const mockPauseWorker = vi.fn();
vi.mock("./worker-control.server", () => ({
  isWorkerActive: mockIsWorkerActive,
  pauseWorker: mockPauseWorker,
}));

// Mock notification service
const mockNotifyCookieExpired = vi.fn().mockResolvedValue(undefined);
const mockNotifyJobFailed = vi.fn().mockResolvedValue(undefined);
const mockNotifyWorkerPausedForCookies = vi.fn().mockResolvedValue(undefined);
vi.mock("./notification.server", () => ({
  notifyCookieExpired: mockNotifyCookieExpired,
  notifyJobFailed: mockNotifyJobFailed,
  notifyWorkerPausedForCookies: mockNotifyWorkerPausedForCookies,
}));

const mockCheckPlaylistArchiveReady = vi.fn().mockResolvedValue(undefined);
vi.mock("#app/utils/playlist-archive-ready.server.tsx", () => ({
  checkPlaylistArchiveReadyAfterTrackArchived: mockCheckPlaylistArchiveReady,
}));

const mockExtractAudioMetadata = vi.fn();
vi.mock("#app/utils/audio-metadata.server.ts", () => ({
  extractAudioMetadata: mockExtractAudioMetadata,
}));

const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

function mockPendingArchiveJobs(jobs: Array<Record<string, unknown>>) {
  let remaining = [...jobs];
  mockPrisma.archiveJob.findMany.mockImplementation((args) => {
    if (args?.where?.status === "processing") {
      return Promise.resolve([]);
    }
    const take = args?.take ?? remaining.length;
    return Promise.resolve(remaining.splice(0, take));
  });
}

describe("processQueueTick", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetCookieFailureStreak } = await import("./cookie-failure-streak.ts");
    resetCookieFailureStreak();
    process.env.AUDIO_ARCHIVE_ENABLED = "true";
    mockIsWorkerActive.mockResolvedValue(true);
    mockPauseWorker.mockResolvedValue({
      status: "paused",
      currentlyProcessing: null,
      lastQueueRun: null,
      nextLongBreakAt: null,
      lastStateChange: new Date(),
    });
    mockPrisma.archiveJob.count.mockResolvedValue(0);
    mockPrisma.archiveJob.findMany.mockImplementation((args) => {
      if (args?.where?.status === "processing") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    mockPrisma.workerState.upsert.mockResolvedValue({});
    mockPrisma.youtubeCookie.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.archiveJob.updateMany.mockResolvedValue({ count: 1 });

    mockPersistTrackAudio.mockResolvedValue({
      audioFile: {
        id: "audio-file-1",
        trackId: "track-1",
        objectKey: "audio/tracks/youtube/track-1.mp3",
      },
      objectKey: "audio/tracks/youtube/track-1.mp3",
      created: true,
    });
    mockExecuteYtDlp.mockResolvedValue({
      exitCode: 0,
      stdout: "[download] Destination: /tmp/test-audio.mp3",
      stderr: "",
      filePath: "/tmp/test-audio.mp3",
      errorCategory: null,
      errorMessage: null,
    });
    mockReadFileSync.mockReturnValue(Buffer.from("fake-mp3"));
    mockExtractAudioMetadata.mockResolvedValue({
      duration: 253,
      title: "Embedded Title",
      artist: "Embedded Artist",
      album: "Embedded Album",
      year: 2026,
      releaseDate: "2026-01-15",
      originalDate: "2025-12-01",
      originalYear: 2025,
      track: { no: 3, of: 12 },
      disk: { no: 1, of: 2 },
      // The real extractor derives these from track.of / disk.of
      totalTracks: 12,
      totalDiscs: 2,
      genre: ["Rap"],
      albumArtist: "Embedded Album Artist",
      bpm: 140,
      label: "Embedded Label",
      isrc: "USRC17607839",
      lyrics: "Embedded lyrics",
      bitrate: 320,
      sampleRate: 44100,
      format: "mp3",
      mimeType: "audio/mpeg",
    });
    mockPrisma.artist.findMany.mockResolvedValue([
      { id: "artist-embedded", name: "Embedded Artist" },
    ]);
    mockPrisma.track.findUnique.mockResolvedValue({ artistId: "artist-existing" });
    mockPrisma.track.update.mockResolvedValue({});
    mockPrisma.album.upsert.mockResolvedValue({ id: "album-1" });
  });

  describe("AUDIO_ARCHIVE_ENABLED check", () => {
    it("skips processing when AUDIO_ARCHIVE_ENABLED is not true", async () => {
      const originalAudioArchiveEnabled = process.env.AUDIO_ARCHIVE_ENABLED;
      process.env.AUDIO_ARCHIVE_ENABLED = "false";

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled();

      process.env.AUDIO_ARCHIVE_ENABLED = originalAudioArchiveEnabled;
    });
  });

  describe("worker active check", () => {
    it("skips processing when worker is not active", async () => {
      mockIsWorkerActive.mockResolvedValue(false);

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled();
    });

    it("stops picking up new jobs when worker is paused mid-tick", async () => {
      process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = "1";

      const pendingBatches = [
        [
          {
            id: "job-1",
            track: {
              id: "track-1",
              service: { name: "youtube" },
              serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa1",
            },
          },
        ],
        [
          {
            id: "job-2",
            track: {
              id: "track-2",
              service: { name: "youtube" },
              serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa2",
            },
          },
        ],
      ];

      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        if (args?.where?.status === "processing") {
          return Promise.resolve([]);
        }
        return Promise.resolve(pendingBatches.shift() ?? []);
      });

      mockIsWorkerActive
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).toHaveBeenCalledTimes(1);
    });
  });

  describe("queue draining", () => {
    it("processes multiple batches in one tick until the queue is empty", async () => {
      process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = "1";

      const pendingBatches = [
        [
          {
            id: "job-1",
            track: {
              id: "track-1",
              service: { name: "youtube" },
              serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa1",
            },
          },
        ],
        [
          {
            id: "job-2",
            track: {
              id: "track-2",
              service: { name: "youtube" },
              serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa2",
            },
          },
        ],
      ];

      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        if (args?.where?.status === "processing") {
          return Promise.resolve([]);
        }
        return Promise.resolve(pendingBatches.shift() ?? []);
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).toHaveBeenCalledTimes(2);
    });
  });

  describe("max concurrent limit", () => {
    it("skips when all slots are full", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(2);
      process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = "2";

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.archiveJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "processing" }),
        }),
      );
    });

    it("picks only available slots", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(1);
      process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = "3";
      mockPendingArchiveJobs([]);

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
    });
  });

  describe("empty queue", () => {
    it("does nothing when no pending jobs", async () => {
      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.findMany).toHaveBeenCalled();
      expect(mockExecuteYtDlp).not.toHaveBeenCalled();
    });
  });

  describe("successful job processing", () => {
    it("processes pending jobs: download → upload → complete", async () => {
      delete process.env.COOKIE_FILE_PATH;
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-1",
          status: "pending",
          priority: true,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-1",
            serviceUrl: "https://youtube.com/watch?v=abc123xxxxx",
            service: { name: "youtube" },
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ trackId: "track-1" });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).toHaveBeenCalledWith(
        "https://youtube.com/watch?v=abc123xxxxx",
        expect.objectContaining({ cookieFile: "/data/youtube-cookies.txt" }),
      );
      expect(mockPersistTrackAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: "track-1",
          serviceName: "youtube",
          buffer: expect.any(Buffer),
          metadata: expect.objectContaining({
            format: "mp3",
            mimeType: "audio/mpeg",
            bitrate: 320,
            sampleRate: 44100,
          }),
          extension: "mp3",
        }),
      );
      expect(mockPrisma.track.update).not.toHaveBeenCalled();
      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-1" },
          data: { status: "completed" },
        }),
      );
      expect(mockCheckPlaylistArchiveReady).toHaveBeenCalledWith("track-1", process.env.SITE_URL);
    });

    it("preserves existing track fields when extracted metadata is missing", async () => {
      delete process.env.COOKIE_FILE_PATH;
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-keep",
          status: "pending",
          priority: true,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-keep",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=keepxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ trackId: "track-keep" });
      mockExtractAudioMetadata.mockResolvedValue({
        format: "mp3",
        mimeType: "audio/mpeg",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPersistTrackAudio).toHaveBeenCalled();
    });

    it("completes the job when persistTrackAudio succeeds", async () => {
      delete process.env.COOKIE_FILE_PATH;
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-persist-ok",
          status: "pending",
          priority: true,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-persist-ok",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=okxxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ trackId: "track-persist-ok" });
      mockPersistTrackAudio.mockResolvedValue({
        audioFile: {
          id: "audio-1",
          trackId: "track-persist-ok",
          objectKey: "audio/tracks/youtube/track-persist-ok.mp3",
        },
        objectKey: "audio/tracks/youtube/track-persist-ok.mp3",
        created: true,
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPersistTrackAudio).toHaveBeenCalled();
      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-persist-ok" },
          data: { status: "completed" },
        }),
      );
    });
  });

  describe("download confinement", () => {
    const allowedUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ";

    function queueJob(serviceUrl: string) {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-confine",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-confine",
            service: { name: "youtube" },
            serviceUrl,
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({
        retryCount: 0,
        errorHistory: "[]",
      });
    }

    function jobStatuses(): unknown[] {
      return mockPrisma.archiveJob.update.mock.calls.map((call) => call[0]?.data?.status);
    }

    it("does not start yt-dlp for a non-YouTube URL", async () => {
      queueJob("https://example.com/watch?v=dQw4w9WgXcQ");

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockPersistTrackAudio).not.toHaveBeenCalled();
      expect(jobStatuses()).not.toContain("completed");
    });

    it("does not start yt-dlp for a dash-leading string", async () => {
      queueJob("-https://youtube.com/watch?v=dQw4w9WgXcQ");

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockPersistTrackAudio).not.toHaveBeenCalled();
      expect(jobStatuses()).not.toContain("completed");
    });

    it("reads and uploads an output path inside the temp directory", async () => {
      queueJob(allowedUrl);
      const inside = path.join(os.tmpdir(), "dQw4w9WgXcQ.mp3");
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 0,
        stdout: `[ExtractAudio] Destination: ${inside}`,
        stderr: "",
        filePath: inside,
        errorCategory: null,
        errorMessage: null,
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).toHaveBeenCalledWith(allowedUrl, expect.any(Object));
      expect(mockReadFileSync).toHaveBeenCalledWith(path.resolve(inside));
      expect(mockPersistTrackAudio).toHaveBeenCalled();
      expect(jobStatuses()).toContain("completed");
    });

    it("fails the job without reading an output path outside the temp directory", async () => {
      queueJob(allowedUrl);
      const outside = `${os.tmpdir()}/../outside-archive.mp3`;
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 0,
        stdout: `[ExtractAudio] Destination: ${outside}`,
        stderr: "",
        filePath: outside,
        errorCategory: null,
        errorMessage: null,
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockPersistTrackAudio).not.toHaveBeenCalled();
      expect(jobStatuses()).not.toContain("completed");
      expect(jobStatuses()).toContain("failed");
    });
  });

  describe("error handling", () => {
    it("handles yt-dlp failure: marks as failed for non-retriable errors", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-2",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-2",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=xyzxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: Video unavailable",
        filePath: undefined,
        errorCategory: "VIDEO_UNAVAILABLE",
        errorMessage: "Video unavailable",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-2" },
          data: expect.objectContaining({
            status: "failed",
            retryCount: 1,
            errorHistory: expect.stringContaining("VIDEO_UNAVAILABLE"),
          }),
        }),
      );
      expect(mockPersistTrackAudio).not.toHaveBeenCalled();
    });

    it("marks upload ENOENT as failed immediately without retrying", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-enoent",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-enoent",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=abcxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 0,
        stdout: "[ExtractAudio] Destination: /tmp/abc.mp3",
        stderr: "",
        filePath: "/tmp/abc.mp3",
        errorCategory: null,
        errorMessage: null,
      });
      const enoent = Object.assign(new Error("ENOENT: no such file or directory, stat 'abc.mp3'"), {
        code: "ENOENT",
      });
      mockPersistTrackAudio.mockRejectedValue(enoent);

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-enoent" },
          data: expect.objectContaining({
            status: "failed",
            retryCount: 1,
            errorHistory: expect.stringContaining("FILE_NOT_FOUND"),
          }),
        }),
      );
    });

    it("resets to pending for retriable errors (under max retries)", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-3",
          status: "pending",
          priority: false,
          retryCount: 1,
          errorHistory: "[]",
          track: {
            id: "track-3",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=netxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 1, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: ETIMEDOUT",
        filePath: undefined,
        errorCategory: "NETWORK",
        errorMessage: "Connection timed out",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "pending",
            retryCount: 2,
          }),
        }),
      );
    });

    it("marks as failed when max retries exceeded", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-4",
          status: "pending",
          priority: false,
          retryCount: 3,
          errorHistory: "[]",
          track: {
            id: "track-4",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=maxxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 3, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: ETIMEDOUT",
        filePath: undefined,
        errorCategory: "NETWORK",
        errorMessage: "Timed out",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "failed",
            retryCount: 4,
          }),
        }),
      );
    });

    it("flags cookies invalid and notifies on AUTH error", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-auth",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-auth",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=403xxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "HTTP Error 403: Forbidden",
        filePath: undefined,
        errorCategory: "AUTH",
        errorMessage: "HTTP Error 403: Forbidden",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      // Should flag all valid cookies as invalid
      expect(mockPrisma.youtubeCookie.updateMany).toHaveBeenCalledWith({
        where: { valid: true },
        data: { valid: false, updatedAt: expect.any(Date) },
      });

      // Should notify admin
      expect(mockNotifyCookieExpired).toHaveBeenCalledWith(
        "job-auth",
        "https://youtube.com/watch?v=403xxxxxxxx",
        "HTTP Error 403: Forbidden",
      );

      // Should NOT call notifyJobFailed (cookie notification is separate)
      expect(mockNotifyJobFailed).not.toHaveBeenCalled();
    });

    it("flags cookies invalid and notifies on COOKIE_EXPIRED error", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-cookie",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-cookie",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=cookiexxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: Sign in to confirm",
        filePath: undefined,
        errorCategory: "COOKIE_EXPIRED",
        errorMessage: "Sign in required",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.youtubeCookie.updateMany).toHaveBeenCalledWith({
        where: { valid: true },
        data: { valid: false, updatedAt: expect.any(Date) },
      });
      expect(mockNotifyCookieExpired).toHaveBeenCalledWith(
        "job-cookie",
        "https://youtube.com/watch?v=cookiexxxxx",
        "Sign in required",
      );
      expect(mockNotifyJobFailed).not.toHaveBeenCalled();
    });

    it("pauses the worker after 3 consecutive COOKIE_EXPIRED failures", async () => {
      process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = "1";
      mockPrisma.archiveJob.count.mockResolvedValue(0);

      const cookieJobs = [
        {
          id: "job-cookie-1",
          track: {
            id: "track-1",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa1",
          },
        },
        {
          id: "job-cookie-2",
          track: {
            id: "track-2",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa2",
          },
        },
        {
          id: "job-cookie-3",
          track: {
            id: "track-3",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=aaaaaaaaaa3",
          },
        },
      ];

      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        if (args?.where?.status === "processing") {
          return Promise.resolve([]);
        }
        return Promise.resolve(cookieJobs.splice(0, args?.take ?? cookieJobs.length));
      });
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: Sign in to confirm",
        filePath: undefined,
        errorCategory: "COOKIE_EXPIRED",
        errorMessage: "Sign in required",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPauseWorker).toHaveBeenCalledTimes(1);
      expect(mockNotifyWorkerPausedForCookies).toHaveBeenCalledWith(3);
    });

    it("does not pause the worker for AUTH failures without COOKIE_EXPIRED", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-auth",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-auth",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=403xxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "HTTP Error 403: Forbidden",
        filePath: undefined,
        errorCategory: "AUTH",
        errorMessage: "HTTP Error 403: Forbidden",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPauseWorker).not.toHaveBeenCalled();
      expect(mockNotifyWorkerPausedForCookies).not.toHaveBeenCalled();
    });

    it("resets the cookie failure streak after a successful archive", async () => {
      process.env.AUDIO_ARCHIVE_MAX_CONCURRENT = "1";
      mockPrisma.archiveJob.count.mockResolvedValue(0);

      const jobs = [
        {
          id: "job-fail-1",
          track: {
            id: "track-1",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=fail1xxxxxx",
          },
        },
        {
          id: "job-fail-2",
          track: {
            id: "track-2",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=fail2xxxxxx",
          },
        },
        {
          id: "job-success",
          track: {
            id: "track-3",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=okxxxxxxxxx",
          },
        },
        {
          id: "job-fail-3",
          track: {
            id: "track-4",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=fail3xxxxxx",
          },
        },
      ];

      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        if (args?.where?.status === "processing") {
          return Promise.resolve([]);
        }
        return Promise.resolve(jobs.splice(0, args?.take ?? jobs.length));
      });
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: Sign in to confirm",
          filePath: undefined,
          errorCategory: "COOKIE_EXPIRED",
          errorMessage: "Sign in required",
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: Sign in to confirm",
          filePath: undefined,
          errorCategory: "COOKIE_EXPIRED",
          errorMessage: "Sign in required",
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "[ExtractAudio] Destination: /tmp/test-audio.mp3",
          stderr: "",
          filePath: "/tmp/test-audio.mp3",
          errorCategory: null,
          errorMessage: null,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: Sign in to confirm",
          filePath: undefined,
          errorCategory: "COOKIE_EXPIRED",
          errorMessage: "Sign in required",
        });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPauseWorker).not.toHaveBeenCalled();
    });

    it("notifies on GEO_BLOCKED permanent failure", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-geo",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-geo",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=geoxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: not available in your country",
        filePath: undefined,
        errorCategory: "GEO_BLOCKED",
        errorMessage: "Not available in your country",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      // Should NOT flag cookies (not auth/cookie related)
      expect(mockPrisma.youtubeCookie.updateMany).not.toHaveBeenCalled();
      expect(mockNotifyCookieExpired).not.toHaveBeenCalled();

      // Should notify about geo-blocked failure
      expect(mockNotifyJobFailed).toHaveBeenCalledWith(
        "job-geo",
        "https://youtube.com/watch?v=geoxxxxxxxx",
        "GEO_BLOCKED",
        "Not available in your country",
      );
    });

    it("does not notify for retriable errors under max retries", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-net",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-net",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=netxxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 0, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: ETIMEDOUT",
        filePath: undefined,
        errorCategory: "NETWORK",
        errorMessage: "Connection timed out",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      // Should NOT notify (retriable, will be retried)
      expect(mockNotifyCookieExpired).not.toHaveBeenCalled();
      expect(mockNotifyJobFailed).not.toHaveBeenCalled();
      expect(mockPrisma.youtubeCookie.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("exponential backoff (Decision #5)", () => {
    function lastUpdateData(jobId: string): Record<string, unknown> {
      const calls = mockPrisma.archiveJob.update.mock.calls.filter(
        (call) => call[0]?.where?.id === jobId,
      );
      return (calls.at(-1)?.[0]?.data ?? {}) as Record<string, unknown>;
    }

    function queueRetriableJob(jobId: string, retryCount: number) {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: jobId,
          status: "pending",
          priority: false,
          retryCount,
          errorHistory: "[]",
          track: {
            id: `track-${jobId}`,
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=backoffxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: ETIMEDOUT",
        filePath: undefined,
        errorCategory: "NETWORK",
        errorMessage: "Connection timed out",
      });
    }

    function expectBackoff(jobId: string, expectedRetryCount: number, delayMs: number) {
      return async () => {
        queueRetriableJob(jobId, expectedRetryCount - 1);
        const before = Date.now();
        const { processQueueTick } = await import("./worker.server.ts");
        await processQueueTick();
        const after = Date.now();

        const data = lastUpdateData(jobId);
        expect(data.status).toBe("pending");
        expect(data.retryCount).toBe(expectedRetryCount);

        const nextAttemptAt = data.nextAttemptAt as Date;
        expect(nextAttemptAt).toBeInstanceOf(Date);
        expect(nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + delayMs);
        expect(nextAttemptAt.getTime()).toBeLessThanOrEqual(after + delayMs);
      };
    }

    it("schedules the 1st retry 5 minutes out", expectBackoff("job-backoff-1", 1, 5 * 60_000));

    it("schedules the 2nd retry 30 minutes out", expectBackoff("job-backoff-2", 2, 30 * 60_000));

    it("schedules the 3rd retry 2 hours out", expectBackoff("job-backoff-3", 3, 2 * 60 * 60_000));

    it("clears nextAttemptAt on permanent failure", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-backoff-perm",
          status: "pending",
          priority: false,
          retryCount: 3,
          errorHistory: "[]",
          track: {
            id: "track-backoff-perm",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=backoffxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ retryCount: 3, errorHistory: "[]" });
      mockExecuteYtDlp.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: ETIMEDOUT",
        filePath: undefined,
        errorCategory: "NETWORK",
        errorMessage: "Connection timed out",
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      const data = lastUpdateData("job-backoff-perm");
      expect(data.status).toBe("failed");
      expect(data.nextAttemptAt).toBeNull();
    });

    it("filters the pending pick to jobs whose nextAttemptAt has elapsed", async () => {
      const pendingCalls: Array<{ where?: { status?: string; OR?: unknown } }> = [];
      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        if (args?.where?.status === "processing") return Promise.resolve([]);
        pendingCalls.push(args);
        return Promise.resolve([]);
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(pendingCalls[0]?.where?.status).toBe("pending");
      expect(pendingCalls[0]?.where?.OR).toEqual([
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: expect.any(Date) } },
      ]);
    });
  });

  describe("atomic job claim", () => {
    it("claims the job with a pending-status guard", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-claim",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-claim",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=claimxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.findUnique.mockResolvedValue({ trackId: "track-claim" });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockPrisma.archiveJob.updateMany).toHaveBeenCalledWith({
        where: { id: "job-claim", status: "pending" },
        data: { status: "processing", lastAttemptAt: expect.any(Date) },
      });
    });

    it("skips the job when the atomic claim updates 0 rows (lost race)", async () => {
      mockPrisma.archiveJob.count.mockResolvedValue(0);
      mockPendingArchiveJobs([
        {
          id: "job-race",
          status: "pending",
          priority: false,
          retryCount: 0,
          errorHistory: "[]",
          track: {
            id: "track-race",
            service: { name: "youtube" },
            serviceUrl: "https://youtube.com/watch?v=racexxxxxxxx",
          },
        },
      ]);
      mockPrisma.archiveJob.updateMany.mockResolvedValue({ count: 0 });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(mockExecuteYtDlp).not.toHaveBeenCalled();
      expect(mockPersistTrackAudio).not.toHaveBeenCalled();
    });
  });

  describe("tick error containment", () => {
    it("resolves without rejecting when the tick body throws (no unhandled rejection)", async () => {
      const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
      mockPrisma.archiveJob.count.mockRejectedValue(new Error("transient DB hiccup"));

      const { processQueueTick } = await import("./worker.server.ts");
      await expect(processQueueTick()).resolves.toBeUndefined();

      expect(consoleErrorMock).toHaveBeenCalledWith("processQueueTick failed:", expect.any(Error));
      consoleErrorMock.mockRestore();
    });
  });

  describe("stale processing recovery", () => {
    it("requeues jobs stuck in processing past the stale threshold", async () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        if (args?.where?.status === "processing") {
          return Promise.resolve([
            {
              id: "stale-job-1",
              retryCount: 0,
              errorHistory: "[]",
            },
          ]);
        }
        return Promise.resolve([]);
      });
      mockPrisma.archiveJob.findUnique.mockResolvedValue({
        retryCount: 0,
        errorHistory: "[]",
      });

      const { recoverStaleProcessingJobs } = await import("./worker.server.ts");
      const recovered = await recoverStaleProcessingJobs();

      expect(recovered).toBe(1);
      expect(mockPrisma.archiveJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stale-job-1" },
          data: expect.objectContaining({ status: "pending" }),
        }),
      );
      expect(mockPrisma.workerState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {},
        }),
      );
      consoleWarn.mockRestore();
    });

    it("runs stale recovery before picking new jobs", async () => {
      const findManyCalls: Array<{ where?: { status?: string } }> = [];
      mockPrisma.archiveJob.findMany.mockImplementation((args) => {
        findManyCalls.push(args);
        return Promise.resolve([]);
      });

      const { processQueueTick } = await import("./worker.server.ts");
      await processQueueTick();

      expect(findManyCalls[0]?.where?.status).toBe("processing");
      expect(findManyCalls[1]?.where?.status).toBe("pending");
    });
  });
});

describe("scheduleQueueTick", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    process.env.AUDIO_ARCHIVE_ENABLED = "true";
    mockIsWorkerActive.mockResolvedValue(true);
    mockPrisma.archiveJob.count.mockResolvedValue(0);
    mockPrisma.archiveJob.findMany.mockResolvedValue([]);
    mockPrisma.workerState.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("debounces wake-ups and runs processQueueTick after the delay", async () => {
    const { scheduleQueueTick } = await import("./worker.server.ts");

    scheduleQueueTick();
    scheduleQueueTick();

    expect(mockExecuteYtDlp).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(mockPrisma.archiveJob.findMany).toHaveBeenCalled();
  });

  it("does nothing when AUDIO_ARCHIVE_ENABLED is not true", async () => {
    process.env.AUDIO_ARCHIVE_ENABLED = "false";
    mockPrisma.archiveJob.findMany.mockClear();

    const { scheduleQueueTick } = await import("./worker.server.ts");
    scheduleQueueTick();

    await vi.advanceTimersByTimeAsync(500);

    expect(mockPrisma.archiveJob.findMany).not.toHaveBeenCalled();
  });
});

describe("getQueueStats", () => {
  it("returns counts for all statuses", async () => {
    mockPrisma.archiveJob.groupBy.mockResolvedValue([
      { status: "pending", _count: { _all: 3 } },
      { status: "processing", _count: { _all: 1 } },
      { status: "completed", _count: { _all: 10 } },
      { status: "failed", _count: { _all: 2 } },
    ]);

    const { getQueueStats } = await import("./worker.server.ts");
    const stats = await getQueueStats();

    expect(stats).toEqual({
      pending: 3,
      processing: 1,
      completed: 10,
      failed: 2,
    });
  });
});
