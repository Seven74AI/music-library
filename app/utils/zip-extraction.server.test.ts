import { describe, expect, test, vi, beforeEach } from "vitest";
import { consoleWarn } from "#tests/setup/setup-test-env";
import { extractAudioFilesFromZip } from "./zip-extraction.server";

// Mock adm-zip as a constructor class
const mockGetEntries = vi.fn();
vi.mock("adm-zip", () => ({
  default: vi.fn(function (this: any, _buffer: Buffer) {
    this.getEntries = mockGetEntries;
  }),
}));

const MB = 1024 * 1024;
const GB = 1024 * MB;

function mockAudioEntry(entryName: string, uncompressedSize: number) {
  const storedBytes = uncompressedSize <= 4096 ? uncompressedSize : 2048;
  return {
    entryName,
    isDirectory: false,
    header: { size: uncompressedSize },
    getData: vi.fn().mockReturnValue(Buffer.alloc(storedBytes, 1)),
  };
}

describe("extractAudioFilesFromZip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarn.mockImplementation(() => {});
  });

  test("extracts audio files from ZIP and filters out non-audio files", async () => {
    mockGetEntries.mockReturnValue([
      {
        entryName: "song1.mp3",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "fake mp3 data")),
        isDirectory: false,
      },
      {
        entryName: "song2.flac",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "fake flac data")),
        isDirectory: false,
      },
      {
        entryName: "readme.txt",
        getData: vi.fn().mockReturnValue(Buffer.from("readme content")),
        isDirectory: false,
      },
      {
        entryName: "folder/",
        getData: vi.fn(),
        isDirectory: true,
      },
    ]);

    const zipBuffer = Buffer.from("fake zip data");
    const result = await extractAudioFilesFromZip(zipBuffer);

    expect(result).toHaveLength(2);
    expect(result[0]?.fileName).toBe("song1.mp3");
    expect(result[0]?.buffer.length).toBeGreaterThanOrEqual(1024);
    expect(result[1]?.fileName).toBe("song2.flac");
    expect(result[1]?.buffer.length).toBeGreaterThanOrEqual(1024);
  });

  test("handles nested directory structures", async () => {
    mockGetEntries.mockReturnValue([
      {
        entryName: "album1/track1.mp3",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "track1 data")),
        isDirectory: false,
      },
      {
        entryName: "album1/track2.wav",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "track2 data")),
        isDirectory: false,
      },
      {
        entryName: "album2/track3.m4a",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "track3 data")),
        isDirectory: false,
      },
    ]);

    const zipBuffer = Buffer.from("fake zip data");
    const result = await extractAudioFilesFromZip(zipBuffer);

    expect(result).toHaveLength(3);
    expect(result[0]?.fileName).toBe("album1/track1.mp3");
    expect(result[1]?.fileName).toBe("album1/track2.wav");
    expect(result[2]?.fileName).toBe("album2/track3.m4a");
  });

  test("returns empty array for ZIP with no audio files", async () => {
    mockGetEntries.mockReturnValue([
      {
        entryName: "readme.txt",
        getData: vi.fn().mockReturnValue(Buffer.from("readme")),
        isDirectory: false,
      },
      {
        entryName: "image.jpg",
        getData: vi.fn().mockReturnValue(Buffer.from("image data")),
        isDirectory: false,
      },
    ]);

    const zipBuffer = Buffer.from("fake zip data");
    const result = await extractAudioFilesFromZip(zipBuffer);

    expect(result).toHaveLength(0);
  });

  test("handles empty ZIP file", async () => {
    mockGetEntries.mockReturnValue([]);

    const zipBuffer = Buffer.from("fake zip data");
    const result = await extractAudioFilesFromZip(zipBuffer);

    expect(result).toHaveLength(0);
  });

  test("supports various audio formats", async () => {
    mockGetEntries.mockReturnValue([
      {
        entryName: "track1.mp3",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "mp3")),
        isDirectory: false,
      },
      {
        entryName: "track2.flac",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "flac")),
        isDirectory: false,
      },
      {
        entryName: "track3.wav",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "wav")),
        isDirectory: false,
      },
      {
        entryName: "track4.m4a",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "m4a")),
        isDirectory: false,
      },
      {
        entryName: "track5.aac",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "aac")),
        isDirectory: false,
      },
      {
        entryName: "track6.ogg",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "ogg")),
        isDirectory: false,
      },
    ]);

    const zipBuffer = Buffer.from("fake zip data");
    const result = await extractAudioFilesFromZip(zipBuffer);

    expect(result).toHaveLength(6);
    expect(result.map((r) => r.fileName)).toEqual([
      "track1.mp3",
      "track2.flac",
      "track3.wav",
      "track4.m4a",
      "track5.aac",
      "track6.ogg",
    ]);
  });

  test("handles case-insensitive file extensions", async () => {
    mockGetEntries.mockReturnValue([
      {
        entryName: "TRACK1.MP3",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "mp3")),
        isDirectory: false,
      },
      {
        entryName: "track2.FLAC",
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, "flac")),
        isDirectory: false,
      },
    ]);

    const zipBuffer = Buffer.from("fake zip data");
    const result = await extractAudioFilesFromZip(zipBuffer);

    expect(result).toHaveLength(2);
  });

  test("throws error for invalid ZIP file", async () => {
    mockGetEntries.mockImplementation(() => {
      throw new Error("Invalid ZIP file");
    });

    const zipBuffer = Buffer.from("invalid zip data");

    await expect(extractAudioFilesFromZip(zipBuffer)).rejects.toThrow("Invalid ZIP file");
  });

  test("allows exactly 100 audio files whose uncompressed total is exactly 1GB", async () => {
    const tenMb = 10 * MB;
    const entries = Array.from({ length: 99 }, (_, index) =>
      mockAudioEntry(`track-${index}.mp3`, tenMb),
    );
    entries.push(mockAudioEntry("last.flac", 34 * MB));
    mockGetEntries.mockReturnValue(entries);

    const result = await extractAudioFilesFromZip(Buffer.from("fake zip data"));

    expect(result).toHaveLength(100);
    expect(result[99]?.fileName).toBe("last.flac");
  });

  test("rejects the extract when audio entries exceed 100", async () => {
    const entries = Array.from({ length: 101 }, (_, index) =>
      mockAudioEntry(`track-${index}.mp3`, 2048),
    );
    mockGetEntries.mockReturnValue(entries);

    await expect(extractAudioFilesFromZip(Buffer.from("fake zip data"))).rejects.toThrow(
      /more than 100 audio files/,
    );
    expect(entries[99]?.getData).toHaveBeenCalled();
    expect(entries[100]?.getData).not.toHaveBeenCalled();
  });

  test("rejects the extract when the running uncompressed total exceeds 1GB", async () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, index) => mockAudioEntry(`track-${index}.mp3`, 100 * MB)),
      mockAudioEntry("overflow.wav", 24 * MB + 1),
    ];
    mockGetEntries.mockReturnValue(entries);

    await expect(extractAudioFilesFromZip(Buffer.from("fake zip data"))).rejects.toThrow(
      /exceeds 1GB/,
    );
    expect(entries[9]?.getData).toHaveBeenCalled();
    expect(entries[10]?.getData).not.toHaveBeenCalled();
  });

  test("stops at the uncompressed total when that cap is reached before 100 files", async () => {
    const entries = Array.from({ length: 101 }, (_, index) =>
      mockAudioEntry(`track-${index}.mp3`, 100 * MB),
    );
    mockGetEntries.mockReturnValue(entries);

    await expect(extractAudioFilesFromZip(Buffer.from("fake zip data"))).rejects.toThrow(
      /exceeds 1GB/,
    );
    expect(entries[10]?.getData).not.toHaveBeenCalled();
  });

  test("rejects a single audio entry larger than 100MB", async () => {
    const entry = mockAudioEntry("huge.mp3", 100 * MB + 1);
    mockGetEntries.mockReturnValue([entry]);

    await expect(extractAudioFilesFromZip(Buffer.from("fake zip data"))).rejects.toThrow(
      /huge\.mp3 exceeds maximum size of 100MB/,
    );
    expect(entry.getData).not.toHaveBeenCalled();
  });

  test("allows an audio entry of exactly 100MB", async () => {
    mockGetEntries.mockReturnValue([mockAudioEntry("full.mp3", 100 * MB)]);

    const result = await extractAudioFilesFromZip(Buffer.from("fake zip data"));

    expect(result).toHaveLength(1);
    expect(result[0]?.fileName).toBe("full.mp3");
  });

  test("does not count skipped entries toward the file or size caps", async () => {
    const audio = Array.from({ length: 100 }, (_, index) =>
      mockAudioEntry(`keep-${index}.mp3`, 2048),
    );
    const ignored = [
      {
        entryName: "folder/",
        isDirectory: true,
        header: { size: 0 },
        getData: vi.fn(),
      },
      {
        entryName: "readme.txt",
        isDirectory: false,
        header: { size: 2 * GB },
        getData: vi.fn().mockReturnValue(Buffer.from("notes")),
      },
      {
        entryName: "__MACOSX/._keep-0.mp3",
        isDirectory: false,
        header: { size: 5 * MB },
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, 1)),
      },
      {
        entryName: "album/._resource.mp3",
        isDirectory: false,
        header: { size: 5 * MB },
        getData: vi.fn().mockReturnValue(Buffer.alloc(2048, 1)),
      },
      mockAudioEntry("tiny.mp3", 100),
    ];
    mockGetEntries.mockReturnValue([...audio, ...ignored]);

    const result = await extractAudioFilesFromZip(Buffer.from("fake zip data"));

    expect(result).toHaveLength(100);
    expect(result.map((file) => file.fileName)).not.toContain("tiny.mp3");
    expect(ignored[1]?.getData).not.toHaveBeenCalled();
    expect(ignored[2]?.getData).not.toHaveBeenCalled();
    expect(ignored[4]?.getData).not.toHaveBeenCalled();
  });
});
