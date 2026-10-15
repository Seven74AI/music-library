// @context7: adm-zip, Buffer, TypeScript
import AdmZip from "adm-zip";

export interface ExtractedAudioFile {
  fileName: string;
  buffer: Buffer;
}

/**
 * Supported audio file extensions
 */
const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "webm"]);

/** Same per-file ceiling as a direct audio upload. */
const MAX_FILE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_ENTRIES = 100;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MIN_AUDIO_BYTES = 1024;

class ZipExtractionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipExtractionLimitError";
  }
}

/**
 * Check if a file extension is an audio format
 */
function isAudioFile(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension ? AUDIO_EXTENSIONS.has(extension) : false;
}

function declaredUncompressedSize(entry: { header?: { size?: number } }): number | null {
  const size = entry.header?.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  return size;
}

function assertWithinExtractionLimits(
  fileName: string,
  uncompressedBytes: number,
  audioCount: number,
  runningTotal: number,
) {
  if (uncompressedBytes > MAX_FILE_UNCOMPRESSED_BYTES) {
    throw new ZipExtractionLimitError(
      `File ${fileName} exceeds maximum size of ${MAX_FILE_UNCOMPRESSED_BYTES / 1024 / 1024}MB`,
    );
  }

  if (audioCount >= MAX_AUDIO_ENTRIES) {
    throw new ZipExtractionLimitError(
      `ZIP archive contains more than ${MAX_AUDIO_ENTRIES} audio files`,
    );
  }

  if (runningTotal + uncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new ZipExtractionLimitError("Uncompressed audio in the ZIP exceeds 1GB");
  }
}

/**
 * Extract all audio files from a ZIP archive.
 * Rejects the whole archive when audio entries exceed 100, a single audio
 * entry exceeds 100MB, or the running uncompressed total exceeds 1GB.
 *
 * @param zipBuffer - ZIP file buffer
 * @returns Promise resolving to array of extracted audio files with their original filenames
 */
export async function extractAudioFilesFromZip(zipBuffer: Buffer): Promise<ExtractedAudioFile[]> {
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    const audioFiles: ExtractedAudioFile[] = [];
    let runningTotal = 0;

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) {
        continue;
      }

      const fileName = entry.entryName;

      // Skip macOS metadata files FIRST (before any other checks)
      // - Files in __MACOSX/ directory
      // - Files whose filename (basename) starts with ._ (macOS resource fork files)
      // Note: We check the basename only, not the full path, to avoid filtering
      // legitimate files that might have underscores in their titles
      const basename = fileName.split("/").pop() || fileName;
      if (fileName.includes("__MACOSX/") || basename.startsWith("._")) {
        continue;
      }

      // Check if file has a valid audio extension (only process files from our allowed list)
      if (!isAudioFile(fileName)) {
        continue;
      }

      const declaredSize = declaredUncompressedSize(entry);
      // Skip files that are too small (likely corrupted or metadata files)
      // before decompressing them. Audio files should be at least a few KB.
      if (declaredSize !== null && declaredSize < MIN_AUDIO_BYTES) {
        continue;
      }

      if (declaredSize !== null) {
        assertWithinExtractionLimits(fileName, declaredSize, audioFiles.length, runningTotal);
      }

      // Extract file data (getData returns Buffer directly)
      const buffer = entry.getData();
      const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      if (fileBuffer.length < MIN_AUDIO_BYTES) {
        continue;
      }

      const uncompressedBytes =
        declaredSize === null ? fileBuffer.length : Math.max(declaredSize, fileBuffer.length);
      if (declaredSize === null || uncompressedBytes !== declaredSize) {
        assertWithinExtractionLimits(fileName, uncompressedBytes, audioFiles.length, runningTotal);
      }

      audioFiles.push({
        fileName,
        buffer: fileBuffer,
      });
      runningTotal += uncompressedBytes;
    }

    return audioFiles;
  } catch (error) {
    if (error instanceof ZipExtractionLimitError) {
      throw error;
    }
    throw new Error(
      `Failed to extract audio files from ZIP: ${error instanceof Error ? error.message : "Unknown error"}`,
      { cause: error },
    );
  }
}
