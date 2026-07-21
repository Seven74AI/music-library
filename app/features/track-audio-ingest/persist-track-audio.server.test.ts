import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ExtractedAudioMetadata } from "#app/utils/audio-metadata.server";

const mockUploadFile = vi.fn();
const mockBuildAudioObjectKey = vi.fn();

vi.mock("#app/utils/storage.server", () => ({
  uploadFile: mockUploadFile,
  buildAudioObjectKey: mockBuildAudioObjectKey,
}));

const mockBackfillTrackMetadata = vi.fn();
vi.mock("./backfill-track-metadata.server.ts", () => ({
  backfillTrackMetadata: mockBackfillTrackMetadata,
}));

const mockPrisma = {
  trackAudioFile: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: mockPrisma,
}));

const sampleMetadata: ExtractedAudioMetadata = {
  format: "mp3",
  mimeType: "audio/mpeg",
  bitrate: 320,
  sampleRate: 44100,
  duration: 180,
  title: "Test Track",
  artist: "Test Artist",
};

const sampleBuffer = Buffer.from("fake-audio-bytes");

describe("persistTrackAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildAudioObjectKey.mockImplementation(
      (serviceName: string, trackId: string, extension: string) =>
        `audio/tracks/${serviceName}/${trackId}.${extension}`,
    );
    mockUploadFile.mockResolvedValue("audio/tracks/youtube/track-1.mp3");
    mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);
    mockPrisma.trackAudioFile.create.mockResolvedValue({
      id: "audio-file-1",
      trackId: "track-1",
      objectKey: "audio/tracks/youtube/track-1.mp3",
    });
    mockBackfillTrackMetadata.mockResolvedValue(undefined);
  });

  it("uploads to storage before creating TrackAudioFile", async () => {
    const callOrder: string[] = [];
    mockUploadFile.mockImplementation(async () => {
      callOrder.push("upload");
      return "audio/tracks/youtube/track-1.mp3";
    });
    mockPrisma.trackAudioFile.create.mockImplementation(async () => {
      callOrder.push("create");
      return { id: "audio-file-1" };
    });

    const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
    await persistTrackAudio({
      trackId: "track-1",
      serviceName: "youtube",
      buffer: sampleBuffer,
      metadata: sampleMetadata,
    });

    expect(callOrder).toEqual(["upload", "create"]);
    expect(mockBuildAudioObjectKey).toHaveBeenCalledWith("youtube", "track-1", "mp3");
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file: sampleBuffer,
        key: "audio/tracks/youtube/track-1.mp3",
        contentType: "audio/mpeg",
      }),
    );
  });

  it("creates TrackAudioFile via prisma when no transaction is provided", async () => {
    const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
    const result = await persistTrackAudio({
      trackId: "track-1",
      serviceName: "youtube",
      buffer: sampleBuffer,
      metadata: sampleMetadata,
    });

    expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trackId: "track-1",
          objectKey: "audio/tracks/youtube/track-1.mp3",
          format: "mp3",
          mimeType: "audio/mpeg",
          fileSize: sampleBuffer.length,
          bitrate: 320,
          sampleRate: 44100,
        }),
      }),
    );
    expect(result.audioFile.id).toBe("audio-file-1");
    expect(result.objectKey).toBe("audio/tracks/youtube/track-1.mp3");
  });

  it("uses the transaction client when tx is provided", async () => {
    const txTrackAudioFile = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "tx-audio-file" }),
    };
    const tx = { trackAudioFile: txTrackAudioFile };

    const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
    await persistTrackAudio({
      trackId: "track-local",
      serviceName: "local",
      buffer: sampleBuffer,
      metadata: sampleMetadata,
      uploadedBy: "user-1",
      serviceId: "service-local",
      fileName: "song.mp3",
      tx: tx as never,
    });

    expect(txTrackAudioFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trackId: "track-local",
          serviceId: "service-local",
          uploadedBy: "user-1",
          fileName: "song.mp3",
        }),
      }),
    );
    expect(mockPrisma.trackAudioFile.create).not.toHaveBeenCalled();
    expect(mockBackfillTrackMetadata).not.toHaveBeenCalled();
  });

  it("is idempotent when a TrackAudioFile already exists", async () => {
    const existing = {
      id: "existing-audio",
      trackId: "track-1",
      objectKey: "audio/tracks/youtube/track-1.mp3",
    };
    mockPrisma.trackAudioFile.findFirst.mockResolvedValue(existing);

    const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
    const result = await persistTrackAudio({
      trackId: "track-1",
      serviceName: "youtube",
      buffer: sampleBuffer,
      metadata: sampleMetadata,
    });

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockPrisma.trackAudioFile.create).not.toHaveBeenCalled();
    expect(result.audioFile).toEqual(existing);
    expect(result.objectKey).toBe(existing.objectKey);
  });

  it("does not throw when metadata backfill fails", async () => {
    const { consoleError } = await import("#tests/setup/setup-test-env.ts");
    consoleError.mockImplementation(() => {});
    mockBackfillTrackMetadata.mockRejectedValue(new Error("backfill failed"));

    const { persistTrackAudio } = await import("./persist-track-audio.server.ts");

    await expect(
      persistTrackAudio({
        trackId: "track-1",
        serviceName: "youtube",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      }),
    ).resolves.toBeDefined();

    expect(mockPrisma.trackAudioFile.create).toHaveBeenCalled();
  });

  it("backfills track metadata after a successful persist", async () => {
    const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
    await persistTrackAudio({
      trackId: "track-1",
      serviceName: "youtube",
      buffer: sampleBuffer,
      metadata: sampleMetadata,
    });

    expect(mockBackfillTrackMetadata).toHaveBeenCalledWith("track-1", sampleMetadata);
  });
});
