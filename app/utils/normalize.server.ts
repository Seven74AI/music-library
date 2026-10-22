/**
 * Normalization utilities for duplicate detection
 * ADR-034: Duplicate Detection Algorithm
 */

/**
 * Normalize an artist name for duplicate detection.
 * Rules:
 * - Convert to lowercase
 * - Trim whitespace
 * - Remove leading "the"
 * - Remove special characters and punctuation
 * - Collapse multiple spaces into one
 * - Normalize Unicode characters
 *
 * Examples:
 * - "The Beatles" → "beatles"
 * - "AC/DC" → "acdc"
 * - "Björk" → "bjork"
 */
export function normalizeArtistName(name: string): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  return (
    name
      .toLowerCase()
      .trim()
      // Normalize Unicode (e.g., "Björk" → "bjork")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // Remove leading "the" (with word boundary)
      .replace(/^the\s+/i, "")
      // Remove all special characters and punctuation
      .replace(/[^\w\s]/g, "")
      // Collapse multiple spaces into one
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Normalize an album name for duplicate detection.
 * Rules:
 * - Convert to lowercase
 * - Trim whitespace
 * - Remove edition markers (remaster, deluxe, expanded, special edition)
 * - Remove special characters and punctuation
 * - Collapse multiple spaces into one
 * - Normalize Unicode characters
 *
 * Examples:
 * - "OK Computer [Remaster]" → "ok computer"
 * - "Kid A (Collector's Edition)" → "kid a collectors edition"
 */
export function normalizeAlbumName(name: string): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  return (
    name
      .toLowerCase()
      .trim()
      // Normalize Unicode
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // Remove edition markers
      .replace(/\[(remaster|deluxe|expanded|special edition|bonus|anniversary)\]/gi, "")
      .replace(
        /\((remaster|deluxe|expanded|special edition|bonus|anniversary|collector'?s?)\)/gi,
        "",
      )
      // Remove special characters and punctuation
      .replace(/[^\w\s]/g, "")
      // Collapse multiple spaces
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Check if two normalized names are exact matches
 */
export function isExactMatch(normalized1: string, normalized2: string): boolean {
  return normalized1 === normalized2;
}
