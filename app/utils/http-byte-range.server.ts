export type ParsedByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/** Parse a `Range: bytes=…` header against a known object size (RFC 7233 subset). */
export function parseByteRangeHeader(
  rangeHeader: string | null,
  fileSize: number,
): ParsedByteRange {
  if (!rangeHeader) {
    return { kind: "full" };
  }

  const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!rangeMatch?.[1]) {
    return { kind: "full" };
  }

  const start = parseInt(rangeMatch[1], 10);
  if (start >= fileSize || start < 0) {
    return { kind: "unsatisfiable" };
  }

  const requestedEnd = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;
  const end = Math.min(requestedEnd, fileSize - 1);

  if (start > end) {
    return { kind: "unsatisfiable" };
  }

  return { kind: "partial", start, end };
}
