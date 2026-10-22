import { describe, expect, it, vi, beforeEach } from "vitest";
import { compressChromaprint } from "#tests/chromaprint-test-utils";

// Mock fs/promises
const mockWriteFile = vi.fn();
const mockUnlink = vi.fn();
vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

// Mock fpcalc (callback-based API)
const mockFpcalc = vi.fn();
vi.mock("fpcalc", () => ({
  default: (filePath: string, options: any, callback: (err: Error | null, result: any) => void) => {
    mockFpcalc(filePath, options, callback);
  },
}));

describe("calculateAudioHash", () => {
  it("calculates SHA-256 hash of audio buffer", async () => {
    const { calculateAudioHash } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    const hash = await calculateAudioHash(buffer);

    expect(hash).toBe("522272b26299fafc953e105f7f113422487ef7e4ddce23056532238b6ca29213");
  });

  it("produces different hashes for different buffers", async () => {
    const { calculateAudioHash } = await import("./audio-file-management.server");
    const buffer1 = Buffer.from("audio-data-1");
    const buffer2 = Buffer.from("audio-data-2");

    const hash1 = await calculateAudioHash(buffer1);
    const hash2 = await calculateAudioHash(buffer2);

    expect(hash1).not.toBe(hash2);
  });

  it("produces same hash for identical buffers", async () => {
    const { calculateAudioHash } = await import("./audio-file-management.server");
    const buffer1 = Buffer.from("same-audio-data");
    const buffer2 = Buffer.from("same-audio-data");

    const hash1 = await calculateAudioHash(buffer1);
    const hash2 = await calculateAudioHash(buffer2);

    expect(hash1).toBe(hash2);
  });
});

describe("generateAudioFingerprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  it("generates fingerprint for audio buffer", async () => {
    mockFpcalc.mockImplementation((filePath: string, options: any, callback: any) => {
      callback(null, {
        fingerprint: "AQADtNE123test-fingerprint",
        duration: 180,
      });
    });

    const { generateAudioFingerprint } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    const fingerprint = await generateAudioFingerprint(buffer);

    expect(fingerprint).toBe("AQADtNE123test-fingerprint");
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining("audio-"), buffer);
    expect(mockFpcalc).toHaveBeenCalled();
  });

  it("cleans up temporary file after successful fingerprint generation", async () => {
    mockFpcalc.mockImplementation((filePath: string, options: any, callback: any) => {
      callback(null, {
        fingerprint: "AQADtestfp",
        duration: 180,
      });
    });

    const { generateAudioFingerprint } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    await generateAudioFingerprint(buffer);

    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining("audio-"));
  });

  it("returns null when fpcalc returns no fingerprint", async () => {
    const { consoleWarn } = await import("#tests/setup/setup-test-env.ts");
    consoleWarn.mockImplementation(() => {});

    mockFpcalc.mockImplementation((filePath: string, options: any, callback: any) => {
      callback(null, {
        duration: 180,
        // No fingerprint field
      });
    });

    const { generateAudioFingerprint } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    const result = await generateAudioFingerprint(buffer);

    expect(result).toBeNull();
  });

  it("returns null when fpcalc throws error", async () => {
    const { consoleError } = await import("#tests/setup/setup-test-env.ts");
    consoleError.mockImplementation(() => {});

    mockFpcalc.mockImplementation((filePath: string, options: any, callback: any) => {
      callback(new Error("fpcalc failed"));
    });

    const { generateAudioFingerprint } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    const result = await generateAudioFingerprint(buffer);

    expect(result).toBeNull();
  });

  it("cleans up temporary file even when fpcalc fails", async () => {
    const { consoleError } = await import("#tests/setup/setup-test-env.ts");
    consoleError.mockImplementation(() => {});

    mockFpcalc.mockImplementation((filePath: string, options: any, callback: any) => {
      callback(new Error("fpcalc failed"));
    });

    const { generateAudioFingerprint } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    await generateAudioFingerprint(buffer);

    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining("audio-"));
  });

  it("handles cleanup errors gracefully", async () => {
    mockFpcalc.mockImplementation((filePath: string, options: any, callback: any) => {
      callback(null, {
        fingerprint: "AQADtestfp",
        duration: 180,
      });
    });
    mockUnlink.mockRejectedValue(new Error("cleanup failed"));

    const { generateAudioFingerprint } = await import("./audio-file-management.server");
    const buffer = Buffer.from("test-audio-data");
    const result = await generateAudioFingerprint(buffer);

    // Should still return the fingerprint despite cleanup error
    expect(result).toBe("AQADtestfp");
  });
});

describe("decodeChromaprintFingerprint", () => {
  it("decodes the upstream chromaprint test vector", async () => {
    const { decodeChromaprintFingerprint } = await import("./audio-file-management.server");
    // From chromaprint tests/test_fingerprint_decompressor.cpp (Long case).
    const fp =
      "AQAAEwkjrUmSJQpUHflR9mjSJMdZpcO_Imdw9dCO9Clu4_wQPvhCB01w6xAtXNcAp5RASgDBhDSCGGIAcwA";
    expect(decodeChromaprintFingerprint(fp)).toEqual([
      3707512163, 3703317537, 3720098848, 3717993776, 3751570752, 1330439488, 1326360000,
      1326355649, 1191625921, 1192674515, 1194804466, 1195336818, 1165981042, 1165956451,
      1157441379, 1157441299, 1291679571, 1291673457, 1170079601,
    ]);
  });

  it("round-trips through the compressor", async () => {
    const { decodeChromaprintFingerprint } = await import("./audio-file-management.server");
    const raw = [0, 1, 7, 1 << 6, 0xdeadbeef, 0xffffffff, 1 << 31];
    expect(decodeChromaprintFingerprint(compressChromaprint(raw))).toEqual(raw.map((v) => v >>> 0));
  });

  it("returns null for non-base64url input", async () => {
    const { decodeChromaprintFingerprint } = await import("./audio-file-management.server");
    expect(decodeChromaprintFingerprint("AQADtNE123test===")).toBeNull();
    expect(decodeChromaprintFingerprint("not a fingerprint!")).toBeNull();
  });

  it("returns null for empty and too-short input", async () => {
    const { decodeChromaprintFingerprint } = await import("./audio-file-management.server");
    expect(decodeChromaprintFingerprint("")).toBeNull();
    expect(decodeChromaprintFingerprint("AQ")).toBeNull();
  });
});

describe("calculateFingerprintSimilarity", () => {
  it("returns 1 for identical fingerprints", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");
    const fp = compressChromaprint([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(calculateFingerprintSimilarity(fp, fp)).toBe(1);
  });

  it("returns 0 for empty fingerprints", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");

    expect(calculateFingerprintSimilarity("", "")).toBe(0);
    expect(calculateFingerprintSimilarity("AQAD", "")).toBe(0);
    expect(calculateFingerprintSimilarity("", "AQAD")).toBe(0);
  });

  it("returns 0 when a fingerprint is not valid Chromaprint", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");
    const valid = compressChromaprint([1, 2, 3, 4]);

    expect(calculateFingerprintSimilarity(valid, "not a fingerprint!")).toBe(0);
    expect(calculateFingerprintSimilarity("not a fingerprint!", valid)).toBe(0);
  });

  it("measures a single bit flip as 1 / totalBits distance", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");
    const raw = [0x00000001, 0x12345678, 0x9abcdef0, 0xffffffff];
    const fp1 = compressChromaprint(raw);
    const flipped = [...raw];
    flipped[2] = (flipped[2]! ^ 0x00008000) >>> 0; // flip one bit in the third subfingerprint
    const fp2 = compressChromaprint(flipped);

    // 4 subfingerprints * 32 bits = 128 total bits; exactly one differs.
    expect(calculateFingerprintSimilarity(fp1, fp2)).toBeCloseTo(1 - 1 / 128, 10);
  });

  it("normalizes by the longer fingerprint length", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");
    const fpShort = compressChromaprint([0x11111111, 0x22222222]);
    const fpLong = compressChromaprint([0x11111111, 0x22222222, 0x33333333, 0x44444444]);

    // 2 aligned subfingerprints match (64 bits), 2 extra differ (64 bits).
    expect(calculateFingerprintSimilarity(fpShort, fpLong)).toBeCloseTo(1 - 64 / 128, 10);
  });

  it("returns 0 for maximally different fingerprints of equal length", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");
    const fp1 = compressChromaprint([0x00000000, 0x00000000]);
    const fp2 = compressChromaprint([0xffffffff, 0xffffffff]);

    expect(calculateFingerprintSimilarity(fp1, fp2)).toBeCloseTo(0, 10);
  });

  it("is order-independent", async () => {
    const { calculateFingerprintSimilarity } = await import("./audio-file-management.server");
    const fp1 = compressChromaprint([0x11111111, 0x22222222, 0x33333333]);
    const fp2 = compressChromaprint([0x11111111, 0x22222222, 0x44444444]);

    const sim1 = calculateFingerprintSimilarity(fp1, fp2);
    const sim2 = calculateFingerprintSimilarity(fp2, fp1);

    expect(sim1).toBe(sim2);
  });
});
