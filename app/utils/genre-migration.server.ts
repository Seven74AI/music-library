/**
 * Genre Migration Utility
 *
 * Parses and normalizes genre names for the multi-genre tagging system.
 */

/**
 * Normalize a genre name for deduplication and comparison
 */
export function normalizeGenreName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove special chars except spaces and hyphens
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Parse a genre string into an array of genre names
 * Handles various delimiters: comma, semicolon, slash, ampersand
 */
export function parseGenreString(genreString: string | null): string[] {
  if (!genreString || genreString.trim() === "") {
    return [];
  }

  // Split by common delimiters and clean up. Ampersand is deliberately NOT a
  // delimiter: it appears inside genre names ("R&B", "Drum & Bass").
  const genres = genreString
    .split(/[,;/]/) // Split by comma, semicolon, or slash
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map((g) => {
      // Capitalize first letter of each word
      return g
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    });

  // Remove duplicates (case-insensitive)
  const uniqueGenres = Array.from(new Map(genres.map((g) => [normalizeGenreName(g), g])).values());

  return uniqueGenres;
}

/** @deprecated Legacy `Track.genre` was removed; use `_TrackGenres` / `replaceTrackGenresFromStrings`. */
export async function migrateTrackGenres(): Promise<{
  tracksProcessed: number;
  genresCreated: number;
  linksCreated: number;
}> {
  return { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 };
}
