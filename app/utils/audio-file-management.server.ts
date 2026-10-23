import { createHash, randomBytes } from "node:crypto";
import childProcess from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type FpcalcResult = { fingerprint?: string; duration?: number } | null;
type FpcalcFn = (
  filePath: string,
  options: Record<string, unknown>,
  callback: (err: Error | null, result: FpcalcResult) => void,
) => void;

type SpawnErrorSink = {
  onError: (error: Error) => void;
};

/**
 * Set only for the synchronous `fpcalc()` call. The patched spawn reads it
 * before returning, so the async `error` event still reaches this call.
 *
 * Correct only because fpcalc invokes `spawn` synchronously inside the call —
 * `activeSpawnErrorSink` is read at spawn time (see installFpcalcSpawnGuard).
 * If a future fpcalc version defers the spawn to a microtask, two concurrent
 * `generateAudioFingerprint` calls could misroute an ENOENT error. A scoped
 * child-process wrapper (spawn override passed to fpcalc) would remove that
 * coupling; the current package API exposes no such hook.
 */
let activeSpawnErrorSink: SpawnErrorSink | null = null;

const spawnGuardFlag = Symbol.for("app.fpcalcSpawnGuard");

type GuardedSpawn = typeof childProcess.spawn & { [spawnGuardFlag]?: boolean };

/**
 * The fpcalc package calls `spawn("fpcalc", args)` and never listens for the
 * child `error` event. A missing binary then throws `spawn fpcalc ENOENT`
 * with no `uncaughtException` handler, which exits the process. Attach the
 * listener on this spawn only; other commands are unchanged.
 */
function installFpcalcSpawnGuard(): void {
  const current = childProcess.spawn as GuardedSpawn;
  if (current[spawnGuardFlag]) return;

  const originalSpawn = current;
  const guarded: GuardedSpawn = function spawnWithFpcalcErrorHandler(
    this: unknown,
    ...spawnArgs: unknown[]
  ) {
    const child = Reflect.apply(originalSpawn, this, spawnArgs) as ReturnType<typeof originalSpawn>;
    const command = spawnArgs[0];
    if (command === "fpcalc") {
      const sink = activeSpawnErrorSink;
      child.on("error", (error: Error) => {
        sink?.onError(error);
      });
    }
    return child;
  } as GuardedSpawn;
  guarded[spawnGuardFlag] = true;
  childProcess.spawn = guarded;
}

let fpcalcPromise: Promise<FpcalcFn> | null = null;

function getFpcalc(): Promise<FpcalcFn> {
  installFpcalcSpawnGuard();
  if (!fpcalcPromise) {
    fpcalcPromise = import("fpcalc").then((mod) => {
      const loaded = mod as { default?: FpcalcFn };
      return loaded.default ?? (mod as unknown as FpcalcFn);
    });
  }
  return fpcalcPromise;
}

/**
 * Calculate SHA-256 hash of audio buffer for deduplication
 * Same pattern as calculateImageHash for cover images
 */
export async function calculateAudioHash(buffer: Buffer): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Generate Chromaprint audio fingerprint for perceptual similarity detection
 * Returns the raw fingerprint string (e.g., "AQADtNE...")
 *
 * @param buffer - Audio file buffer
 * @returns Chromaprint fingerprint string, or null if generation fails
 */
export async function generateAudioFingerprint(buffer: Buffer): Promise<string | null> {
  let tempPath: string | undefined;

  try {
    // Create a temporary file for fpcalc to process
    const tempId = randomBytes(8).toString("hex");
    tempPath = join(tmpdir(), `audio-${tempId}.tmp`);

    await writeFile(tempPath, buffer);

    const fpcalc = await getFpcalc();
    // Generate fingerprint using fpcalc (callback-based API)
    const result = await new Promise<FpcalcResult>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const succeed = (value: FpcalcResult) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      activeSpawnErrorSink = { onError: fail };
      try {
        fpcalc(tempPath!, {}, (err: Error | null, fpResult: FpcalcResult) => {
          if (err) fail(err);
          else succeed(fpResult);
        });
      } finally {
        // spawn() already captured the sink for this call.
        activeSpawnErrorSink = null;
      }
    });

    if (!result || !result.fingerprint) {
      console.warn("fpcalc returned no fingerprint");
      return null;
    }

    return result.fingerprint;
  } catch (error) {
    console.error("Failed to generate audio fingerprint:", error);
    return null;
  } finally {
    // Clean up temporary file
    if (tempPath) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

const CHROMAPRINT_BASE64_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Count set bits in a 32-bit unsigned integer (Hamming weight).
 */
function popcount32(value: number): number {
  let x = value >>> 0;
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

/**
 * Unpack bytes into 3-bit "normal" values of the Chromaprint bit-gap
 * encoding. Mirrors chromaprint's UnpackInt3Array: every 3 bytes yield 8
 * values, packed LSB-first.
 */
function unpackInt3(bytes: Buffer): number[] {
  const out: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (n - i >= 3) {
    const s0 = bytes[i++]!;
    const s1 = bytes[i++]!;
    const s2 = bytes[i++]!;
    out.push(s0 & 0x07, (s0 & 0x38) >> 3, ((s0 & 0xc0) >> 6) | ((s1 & 0x01) << 2));
    out.push((s1 & 0x0e) >> 1, (s1 & 0x70) >> 4, ((s1 & 0x80) >> 7) | ((s2 & 0x03) << 1));
    out.push((s2 & 0x1c) >> 2, (s2 & 0xe0) >> 5);
  }
  if (n - i === 2) {
    const s0 = bytes[i++]!;
    const s1 = bytes[i++]!;
    out.push(s0 & 0x07, (s0 & 0x38) >> 3, ((s0 & 0xc0) >> 6) | ((s1 & 0x01) << 2));
    out.push((s1 & 0x0e) >> 1, (s1 & 0x70) >> 4);
  } else if (n - i === 1) {
    const s0 = bytes[i++]!;
    out.push(s0 & 0x07, (s0 & 0x38) >> 3);
  }
  return out;
}

/**
 * Unpack bytes into 5-bit "exceptional" values of the Chromaprint bit-gap
 * encoding. Mirrors chromaprint's UnpackInt5Array: every 5 bytes yield 8
 * values, packed LSB-first.
 */
function unpackInt5(bytes: Buffer): number[] {
  const out: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (n - i >= 5) {
    const s0 = bytes[i++]!;
    const s1 = bytes[i++]!;
    const s2 = bytes[i++]!;
    const s3 = bytes[i++]!;
    const s4 = bytes[i++]!;
    out.push(s0 & 0x1f, ((s0 & 0xe0) >> 5) | ((s1 & 0x03) << 3), (s1 & 0x7c) >> 2);
    out.push(
      ((s1 & 0x80) >> 7) | ((s2 & 0x0f) << 1),
      ((s2 & 0xf0) >> 4) | ((s3 & 0x01) << 4),
      (s3 & 0x3e) >> 1,
    );
    out.push(((s3 & 0xc0) >> 6) | ((s4 & 0x07) << 2), (s4 & 0xf8) >> 3);
  }
  if (n - i === 4) {
    const s0 = bytes[i++]!;
    const s1 = bytes[i++]!;
    const s2 = bytes[i++]!;
    const s3 = bytes[i++]!;
    out.push(s0 & 0x1f, ((s0 & 0xe0) >> 5) | ((s1 & 0x03) << 3), (s1 & 0x7c) >> 2);
    out.push(
      ((s1 & 0x80) >> 7) | ((s2 & 0x0f) << 1),
      ((s2 & 0xf0) >> 4) | ((s3 & 0x01) << 4),
      (s3 & 0x3e) >> 1,
    );
  } else if (n - i === 3) {
    const s0 = bytes[i++]!;
    const s1 = bytes[i++]!;
    const s2 = bytes[i++]!;
    out.push(s0 & 0x1f, ((s0 & 0xe0) >> 5) | ((s1 & 0x03) << 3), (s1 & 0x7c) >> 2);
    out.push(((s1 & 0x80) >> 7) | ((s2 & 0x0f) << 1));
  } else if (n - i === 2) {
    const s0 = bytes[i++]!;
    const s1 = bytes[i++]!;
    out.push(s0 & 0x1f, ((s0 & 0xe0) >> 5) | ((s1 & 0x03) << 3), (s1 & 0x7c) >> 2);
  } else if (n - i === 1) {
    const s0 = bytes[i++]!;
    out.push(s0 & 0x1f);
  }
  return out;
}

/**
 * Decode a compressed Chromaprint fingerprint (URL-safe base64, no padding)
 * back into its 32-bit subfingerprints.
 *
 * The compressed format stores the XOR-differential of consecutive
 * subfingerprints as run-length "gaps" between set bits (3-bit normal values
 * plus 5-bit exceptional overflows), then base64-encodes the byte stream.
 * This is a direct port of chromaprint's FingerprintDecompressor, validated
 * against its upstream test vectors.
 *
 * @returns Subfingerprints as unsigned 32-bit integers, or null when the
 *          string is not a valid Chromaprint fingerprint.
 */
export function decodeChromaprintFingerprint(fingerprint: string): number[] | null {
  if (!fingerprint || !CHROMAPRINT_BASE64_PATTERN.test(fingerprint)) return null;

  const bytes = Buffer.from(fingerprint, "base64url");
  if (bytes.length < 4) return null;

  // Header: byte 0 = algorithm, bytes 1..3 = 24-bit big-endian item count.
  const size = (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  if (size === 0) return [];

  const normalBits = unpackInt3(bytes.subarray(4));

  // Scan for the `size` zero-terminators, counting exceptional (== 7) values.
  let foundValues = 0;
  let numExceptional = 0;
  let endIndex = normalBits.length;
  for (let i = 0; i < normalBits.length; i++) {
    const bit = normalBits[i]!;
    if (bit === 0) {
      foundValues++;
      if (foundValues === size) {
        endIndex = i + 1;
        break;
      }
    } else if (bit === 7) {
      numExceptional++;
    }
  }
  if (foundValues !== size) return null;

  const bits = normalBits.slice(0, endIndex);
  if (numExceptional > 0) {
    const packedInt3Size = Math.ceil((bits.length * 3) / 8);
    const packedInt5Size = Math.ceil((numExceptional * 5) / 8);
    const start = 4 + packedInt3Size;
    if (bytes.length < start + packedInt5Size) return null;
    const exceptional = unpackInt5(bytes.subarray(start, start + packedInt5Size));
    let j = 0;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === 7) bits[i] = 7 + exceptional[j++]!;
    }
  }

  // Reconstruct subfingerprints from the bit-gap stream. `value` is a running
  // XOR that is intentionally not reset between items, which unwinds the
  // differential encoding back into the original subfingerprint values.
  const output: number[] = [];
  let value = 0;
  let lastBit = 0;
  for (const bit of bits) {
    if (bit === 0) {
      output.push(value >>> 0);
      lastBit = 0;
    } else {
      lastBit += bit;
      if (lastBit > 32) return null;
      value ^= 1 << (lastBit - 1);
    }
  }

  return output;
}

/**
 * Calculate similarity between two Chromaprint fingerprints.
 *
 * Decodes each compressed (base64) fingerprint back into its 32-bit
 * subfingerprints, then returns the normalized bit-error-rate: one minus the
 * Hamming distance (count of differing bits) between the aligned
 * subfingerprints, divided by the total bit length of the longer fingerprint.
 *
 * @param fp1 - First fingerprint string
 * @param fp2 - Second fingerprint string
 * @returns Similarity score between 0 and 1 (1 = identical)
 */
export function calculateFingerprintSimilarity(fp1: string, fp2: string): number {
  if (!fp1 || !fp2) return 0;
  if (fp1 === fp2) return 1;

  const sub1 = decodeChromaprintFingerprint(fp1);
  const sub2 = decodeChromaprintFingerprint(fp2);
  if (!sub1 || !sub2) return 0;

  const totalBits = Math.max(sub1.length, sub2.length) * 32;
  if (totalBits === 0) return 0;

  const aligned = Math.min(sub1.length, sub2.length);
  let distance = 0;
  for (let i = 0; i < aligned; i++) {
    distance += popcount32(sub1[i]! ^ sub2[i]!);
  }
  // Every subfingerprint past the shorter one contributes 32 differing bits.
  distance += Math.abs(sub1.length - sub2.length) * 32;

  return 1 - distance / totalBits;
}
