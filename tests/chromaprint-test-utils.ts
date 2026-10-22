/**
 * Test-only Chromaprint helpers for generating valid compressed fingerprints.
 *
 * These mirror chromaprint's FingerprintCompressor so tests can build real
 * fingerprint strings from raw 32-bit subfingerprint arrays, instead of the
 * fake base64-ish strings that the old character-comparison implementation
 * accepted. Only imported by *.test.ts files.
 */

function packBits(values: number[], width: number): Buffer {
  const bytes: number[] = new Array(Math.ceil((values.length * width) / 8)).fill(0);
  let bitIndex = 0;
  for (const value of values) {
    for (let w = 0; w < width; w++) {
      if ((value >>> w) & 1) {
        const byteIndex = bitIndex >> 3;
        bytes[byteIndex] = bytes[byteIndex]! | (1 << (bitIndex & 7));
      }
      bitIndex++;
    }
  }
  return Buffer.from(bytes);
}

function pushSubfingerprintGaps(x: number, normal: number[], exceptional: number[]): void {
  let bit = 1;
  let lastBit = 0;
  while (x !== 0) {
    if ((x & 1) !== 0) {
      const gap = bit - lastBit;
      if (gap >= 7) {
        normal.push(7);
        exceptional.push(gap - 7);
      } else {
        normal.push(gap);
      }
      lastBit = bit;
    }
    x >>>= 1;
    bit++;
  }
  normal.push(0);
}

/**
 * Compress raw 32-bit subfingerprints into a valid compressed Chromaprint
 * string (URL-safe base64, no padding). Values are treated as unsigned 32-bit.
 */
export function compressChromaprint(raw: number[]): string {
  const normal: number[] = [];
  const exceptional: number[] = [];
  if (raw.length > 0) {
    pushSubfingerprintGaps(raw[0]! >>> 0, normal, exceptional);
    for (let i = 1; i < raw.length; i++) {
      pushSubfingerprintGaps((raw[i]! ^ raw[i - 1]!) >>> 0, normal, exceptional);
    }
  }
  const header = Buffer.from([
    1,
    (raw.length >> 16) & 0xff,
    (raw.length >> 8) & 0xff,
    raw.length & 0xff,
  ]);
  return Buffer.concat([header, packBits(normal, 3), packBits(exceptional, 5)]).toString(
    "base64url",
  );
}
