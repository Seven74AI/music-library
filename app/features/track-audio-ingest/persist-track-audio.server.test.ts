import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ExtractedAudioMetadata } from "#app/utils/audio-metadata.server";

const mockUploadFile = vi.fn();
const mockBuildAudioObjectKey = vi.fn();

vi.mock("#app/utils/storage.server", () => ({
  uploadFile: mockUploadFile,
  buildAudioObjectKey: mockBuildAudioObjectKey,
}));

const mockCalculateAudioHash = vi.fn();
const mockGenerateAudioFingerprint = vi.fn();
const mockCalculateFingerprintSimilarity = vi.fn();
vi.mock("#app/utils/audio-file-management.server", () => ({
  calculateAudioHash: mockCalculateAudioHash,
  generateAudioFingerprint: mockGenerateAudioFingerprint,
  calculateFingerprintSimilarity: mockCalculateFingerprintSimilarity,
}));

const mockBackfillTrackMetadata = vi.fn();
vi.mock("./backfill-track-metadata.server.ts", () => ({
  backfillTrackMetadata: mockBackfillTrackMetadata,
}));

const mockPrisma = {
  trackAudioFile: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  track: {
    findUnique: vi.fn(),
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
    mockCalculateAudioHash.mockResolvedValue("abc123hash");
    mockGenerateAudioFingerprint.mockResolvedValue("AQADtNE123fingerprint");
    mockCalculateFingerprintSimilarity.mockReturnValue(0);
    mockUploadFile.mockResolvedValue("audio/tracks/youtube/track-1.mp3");
    mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);
    mockPrisma.trackAudioFile.findMany.mockResolvedValue([]);
    mockPrisma.track.findUnique.mockResolvedValue({ serviceId: "service-1" });
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

  it("creates the TrackAudioFile via the transaction client when one is provided", async () => {
    const txTrackAudioFile = {
      create: vi.fn().mockResolvedValue({ id: "tx-audio-file" }),
    };
    const tx = { trackAudioFile: txTrackAudioFile };

    const { createTrackAudioFile } = await import("./persist-track-audio.server.ts");
    await createTrackAudioFile(
      {
        trackId: "track-local",
        serviceId: "service-local",
        fileName: "song.mp3",
        metadata: sampleMetadata,
        uploadedBy: "user-1",
        buffer: sampleBuffer,
      },
      {
        objectKey: "audio/tracks/local/track-local.mp3",
        contentHash: "abc123hash",
        audioFingerprint: null,
        isDuplicate: false,
      },
      tx as never,
    );

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

  it("prepareTrackAudioUpload uploads without creating a TrackAudioFile row", async () => {
    const { prepareTrackAudioUpload } = await import("./persist-track-audio.server.ts");
    const prepared = await prepareTrackAudioUpload({
      trackId: "track-1",
      serviceName: "youtube",
      buffer: sampleBuffer,
      metadata: sampleMetadata,
    });

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file: sampleBuffer,
        key: "audio/tracks/youtube/track-1.mp3",
        contentType: "audio/mpeg",
      }),
    );
    expect(prepared.objectKey).toBe("audio/tracks/youtube/track-1.mp3");
    expect(prepared.contentHash).toBe("abc123hash");
    expect(mockPrisma.trackAudioFile.create).not.toHaveBeenCalled();
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

  describe("duplicate detection", () => {
    it("calculates content hash for all uploads", async () => {
      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "track-1",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockCalculateAudioHash).toHaveBeenCalledWith(sampleBuffer);
    });

    it("includes contentHash in created TrackAudioFile", async () => {
      mockCalculateAudioHash.mockResolvedValue("test-hash-123");

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "track-1",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contentHash: "test-hash-123",
          }),
        }),
      );
    });

    it("generates and includes audioFingerprint in created TrackAudioFile", async () => {
      mockGenerateAudioFingerprint.mockResolvedValue("AQADtest-fingerprint");

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "track-1",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockGenerateAudioFingerprint).toHaveBeenCalledWith(sampleBuffer);
      expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            audioFingerprint: "AQADtest-fingerprint",
          }),
        }),
      );
    });

    it("handles null audioFingerprint gracefully when generation fails", async () => {
      mockGenerateAudioFingerprint.mockResolvedValue(null);

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "track-1",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            audioFingerprint: null,
          }),
        }),
      );
    });

    it("detects duplicate audio by content hash", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const duplicateHash = "duplicate-hash-456";
      mockCalculateAudioHash.mockResolvedValue(duplicateHash);

      // First call returns nothing (no existing by trackId)
      // Second call returns existing audio with same hash
      mockPrisma.trackAudioFile.findFirst
        .mockResolvedValueOnce(null) // No existing by trackId
        .mockResolvedValueOnce({
          // Existing by contentHash
          id: "existing-audio-id",
          trackId: "existing-track-id",
          objectKey: "audio/tracks/local/existing-track-id.mp3",
          track: {
            id: "existing-track-id",
            title: "Existing Song",
            artist: {
              name: "Existing Artist",
            },
          },
        });

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should check for existing by trackId first
      expect(mockPrisma.trackAudioFile.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            trackId: "new-track-id",
          }),
        }),
      );

      // Should check for existing by contentHash
      expect(mockPrisma.trackAudioFile.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            contentHash: duplicateHash,
          },
        }),
      );

      // Should mark as duplicate
      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateTrack).toEqual({
        id: "existing-track-id",
        title: "Existing Song",
        artist: {
          name: "Existing Artist",
        },
      });
    });

    it("reuses S3 object key when duplicate detected", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const duplicateHash = "duplicate-hash-789";
      const existingObjectKey = "audio/tracks/local/existing.mp3";
      mockCalculateAudioHash.mockResolvedValue(duplicateHash);

      mockPrisma.trackAudioFile.findFirst
        .mockResolvedValueOnce(null) // No existing by trackId
        .mockResolvedValueOnce({
          // Existing by contentHash
          id: "existing-audio-id",
          trackId: "existing-track-id",
          objectKey: existingObjectKey,
          track: {
            id: "existing-track-id",
            title: "Existing Song",
            artist: { name: "Existing Artist" },
          },
        });

      mockPrisma.trackAudioFile.create.mockResolvedValue({
        id: "new-audio-id",
        trackId: "new-track-id",
        objectKey: existingObjectKey, // Reused!
      });

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should NOT upload to S3 (duplicate)
      expect(mockUploadFile).not.toHaveBeenCalled();

      // Should create TrackAudioFile with existing objectKey
      expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            objectKey: existingObjectKey,
            contentHash: duplicateHash,
          }),
        }),
      );
    });

    it("uploads to S3 when no duplicate detected", async () => {
      mockCalculateAudioHash.mockResolvedValue("unique-hash-999");
      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null); // No duplicates

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "track-1",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should upload to S3 (unique content)
      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file: sampleBuffer,
        }),
      );
    });

    it("calls onProgress immediately for duplicates (no upload needed)", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const onProgress = vi.fn();
      mockCalculateAudioHash.mockResolvedValue("duplicate-hash");

      mockPrisma.trackAudioFile.findFirst
        .mockResolvedValueOnce(null) // No existing by trackId
        .mockResolvedValueOnce({
          // Existing by contentHash
          id: "existing-audio-id",
          trackId: "existing-track-id",
          objectKey: "audio/tracks/local/existing.mp3",
          track: {
            id: "existing-track-id",
            title: "Existing Song",
            artist: { name: "Existing Artist" },
          },
        });

      mockPrisma.trackAudioFile.create.mockResolvedValue({
        id: "new-audio-id",
        trackId: "new-track-id",
        objectKey: "audio/tracks/local/existing.mp3",
      });

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
        onProgress,
      });

      // Should report 100% progress immediately (no upload)
      expect(onProgress).toHaveBeenCalledWith({
        loaded: sampleBuffer.length,
        total: sampleBuffer.length,
      });
      expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("uses this track's own identity as fallback fileName for a duplicate (not the reused objectKey leaf)", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      mockCalculateAudioHash.mockResolvedValue("duplicate-hash");
      mockGenerateAudioFingerprint.mockResolvedValue("AQADsome-fingerprint");

      // No existing by trackId, then an exact-hash match on another track whose
      // objectKey embeds that other track's id.
      mockPrisma.trackAudioFile.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: "existing-audio-id",
        trackId: "existing-track-id",
        objectKey: "audio/tracks/local/existing-track-id.mp3",
        track: {
          id: "existing-track-id",
          title: "Existing Song",
          artist: { name: "Existing Artist" },
        },
      });

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockPrisma.trackAudioFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            objectKey: "audio/tracks/local/existing-track-id.mp3",
            // Must NOT leak the other track's id via the reused objectKey leaf.
            fileName: "new-track-id.mp3",
          }),
        }),
      );
    });
  });

  describe("fingerprint similarity detection", () => {
    it("detects similar audio by fingerprint when similarity >= 90%", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const newFingerprint = "AQADnew-fingerprint";
      const similarFingerprint = "AQADsimilar-fingerprint";

      mockCalculateAudioHash.mockResolvedValue("unique-hash-new");
      mockGenerateAudioFingerprint.mockResolvedValue(newFingerprint);
      mockCalculateFingerprintSimilarity.mockReturnValue(0.95); // 95% similar

      // No exact hash match
      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);

      // Return existing audio with similar fingerprint
      mockPrisma.trackAudioFile.findMany.mockResolvedValue([
        {
          id: "similar-audio-id",
          trackId: "similar-track-id",
          audioFingerprint: similarFingerprint,
          track: {
            id: "similar-track-id",
            title: "Similar Song",
            artist: {
              name: "Similar Artist",
            },
          },
        },
      ]);

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockCalculateFingerprintSimilarity).toHaveBeenCalledWith(
        newFingerprint,
        similarFingerprint,
      );
      expect(result.isSimilar).toBe(true);
      expect(result.similarTrack).toEqual({
        id: "similar-track-id",
        title: "Similar Song",
        artist: {
          name: "Similar Artist",
        },
      });
      expect(result.fingerprintSimilarity).toBe(0.95);
    });

    it("does not mark as similar when similarity < 90%", async () => {
      const newFingerprint = "AQADnew-fingerprint";
      const differentFingerprint = "AQADdifferent-fingerprint";

      mockGenerateAudioFingerprint.mockResolvedValue(newFingerprint);
      mockCalculateFingerprintSimilarity.mockReturnValue(0.75); // 75% similar (below threshold)

      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);
      mockPrisma.trackAudioFile.findMany.mockResolvedValue([
        {
          id: "different-audio-id",
          trackId: "different-track-id",
          audioFingerprint: differentFingerprint,
          track: {
            id: "different-track-id",
            title: "Different Song",
            artist: { name: "Different Artist" },
          },
        },
      ]);

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(result.isSimilar).toBe(false);
      expect(result.similarTrack).toBeUndefined();
      expect(result.fingerprintSimilarity).toBeUndefined();
    });

    it("does not check fingerprint similarity when exact duplicate exists", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const duplicateHash = "duplicate-hash";
      mockCalculateAudioHash.mockResolvedValue(duplicateHash);
      mockGenerateAudioFingerprint.mockResolvedValue("AQADsome-fingerprint");

      // First call returns nothing (no existing by trackId)
      // Second call returns existing audio with same hash (exact duplicate)
      mockPrisma.trackAudioFile.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: "existing-audio-id",
        trackId: "existing-track-id",
        objectKey: "audio/tracks/local/existing.mp3",
        track: {
          id: "existing-track-id",
          title: "Existing Song",
          artist: { name: "Existing Artist" },
        },
      });

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should not check fingerprint similarity when exact duplicate exists
      expect(mockPrisma.trackAudioFile.findMany).not.toHaveBeenCalled();
      expect(result.isDuplicate).toBe(true);
      expect(result.isSimilar).toBeUndefined();
    });

    it("finds most similar fingerprint among multiple candidates", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const newFingerprint = "AQADnew-fingerprint";

      mockGenerateAudioFingerprint.mockResolvedValue(newFingerprint);
      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);

      // Return multiple candidates with different similarities
      mockPrisma.trackAudioFile.findMany.mockResolvedValue([
        {
          id: "audio-1",
          trackId: "track-1",
          audioFingerprint: "AQAD-fp-1",
          track: {
            id: "track-1",
            title: "Song 1",
            artist: { name: "Artist 1" },
          },
        },
        {
          id: "audio-2",
          trackId: "track-2",
          audioFingerprint: "AQAD-fp-2",
          track: {
            id: "track-2",
            title: "Song 2",
            artist: { name: "Artist 2" },
          },
        },
        {
          id: "audio-3",
          trackId: "track-3",
          audioFingerprint: "AQAD-fp-3",
          track: {
            id: "track-3",
            title: "Song 3",
            artist: { name: "Artist 3" },
          },
        },
      ]);

      // Mock similarities: 0.85, 0.92 (highest), 0.88
      mockCalculateFingerprintSimilarity
        .mockReturnValueOnce(0.85)
        .mockReturnValueOnce(0.92)
        .mockReturnValueOnce(0.88);

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should return the most similar one (track-2 with 0.92)
      expect(result.isSimilar).toBe(true);
      expect(result.similarTrack?.id).toBe("track-2");
      expect(result.fingerprintSimilarity).toBe(0.92);
    });

    it("skips fingerprint similarity check when fingerprint generation fails", async () => {
      mockGenerateAudioFingerprint.mockResolvedValue(null);
      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should not check for similar fingerprints
      expect(mockPrisma.trackAudioFile.findMany).not.toHaveBeenCalled();
      expect(result.isSimilar).toBeUndefined();
      expect(result.similarTrack).toBeUndefined();
    });

    it("ignores candidates with null fingerprints during similarity check", async () => {
      const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
      consoleWarn.mockImplementation(() => {});

      const newFingerprint = "AQADnew-fingerprint";

      mockGenerateAudioFingerprint.mockResolvedValue(newFingerprint);
      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);

      // Return candidates including one with null fingerprint
      mockPrisma.trackAudioFile.findMany.mockResolvedValue([
        {
          id: "audio-1",
          trackId: "track-1",
          audioFingerprint: null, // Should be skipped
          track: {
            id: "track-1",
            title: "Song 1",
            artist: { name: "Artist 1" },
          },
        },
        {
          id: "audio-2",
          trackId: "track-2",
          audioFingerprint: "AQAD-fp-2",
          track: {
            id: "track-2",
            title: "Song 2",
            artist: { name: "Artist 2" },
          },
        },
      ]);

      mockCalculateFingerprintSimilarity.mockReturnValue(0.91);

      const { persistTrackAudio } = await import("./persist-track-audio.server.ts");
      const result = await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      // Should only check against the non-null fingerprint
      expect(mockCalculateFingerprintSimilarity).toHaveBeenCalledTimes(1);
      expect(mockCalculateFingerprintSimilarity).toHaveBeenCalledWith(newFingerprint, "AQAD-fp-2");
      expect(result.isSimilar).toBe(true);
      expect(result.similarTrack?.id).toBe("track-2");
    });

    it("blocks perceptual candidates by fingerprint prefix and caps the set", async () => {
      const newFingerprint = "AQADnew-fingerprint-value";
      mockGenerateAudioFingerprint.mockResolvedValue(newFingerprint);
      mockPrisma.trackAudioFile.findFirst.mockResolvedValue(null);
      mockPrisma.trackAudioFile.findMany.mockResolvedValue([]);

      const { persistTrackAudio, FINGERPRINT_BLOCK_PREFIX_LENGTH, SIMILARITY_CANDIDATE_CAP } =
        await import("./persist-track-audio.server.ts");
      await persistTrackAudio({
        trackId: "new-track-id",
        serviceName: "local",
        buffer: sampleBuffer,
        metadata: sampleMetadata,
      });

      expect(mockPrisma.trackAudioFile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            audioFingerprint: {
              startsWith: newFingerprint.slice(0, FINGERPRINT_BLOCK_PREFIX_LENGTH),
            },
          },
          take: SIMILARITY_CANDIDATE_CAP,
          orderBy: { uploadedAt: "desc" },
        }),
      );
    });
  });
});
