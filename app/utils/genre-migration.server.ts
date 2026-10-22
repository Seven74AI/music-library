/**
 * Genre Migration Utility
 *
 * Handles migration of single genre strings to multi-genre system.
 * - Parses genre strings (handling commas, semicolons, slashes)
 * - Creates Genre records
 * - Creates join table entries
 * - Normalizes genre names
 */

import { prisma } from "./db.server.ts";

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

  // Split by common delimiters and clean up
  const genres = genreString
    .split(/[,;/&]/) // Split by comma, semicolon, slash, or ampersand
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

/**
 * Find or create a Genre record by name
 */
export async function findOrCreateGenre(name: string): Promise<string> {
  const normalizedName = normalizeGenreName(name);

  // Try to find existing genre (case-insensitive)
  let genre = await prisma.genre.findFirst({
    where: { normalizedName },
    select: { id: true },
  });

  if (!genre) {
    // Create new genre
    genre = await prisma.genre.create({
      data: {
        name,
        normalizedName,
      },
      select: { id: true },
    });
  }

  return genre.id;
}

/**
 * Migrate track genres from string to multi-genre system
 * Returns count of tracks migrated
 */
export async function migrateTrackGenres(
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<{ tracksProcessed: number; genresCreated: number; linksCreated: number }> {
  const { batchSize = 100, onProgress } = options;

  // Get all tracks with genre strings
  const totalTracks = await prisma.track.count({
    where: {
      OR: [{ genre: { not: null } }, { genre: { not: "" } }],
    },
  });

  let tracksProcessed = 0;
  let genresCreated = 0;
  let linksCreated = 0;

  // Track which genres we've already created to avoid redundant lookups
  const genreCache = new Map<string, string>();

  // Process tracks in batches
  while (tracksProcessed < totalTracks) {
    const tracks = await prisma.track.findMany({
      where: {
        OR: [{ genre: { not: null } }, { genre: { not: "" } }],
      },
      select: { id: true, genre: true },
      take: batchSize,
      skip: tracksProcessed,
    });

    if (tracks.length === 0) break;

    // Process each track
    for (const track of tracks) {
      const genreNames = parseGenreString(track.genre);

      for (const genreName of genreNames) {
        const normalizedName = normalizeGenreName(genreName);

        // Check cache first
        let genreId = genreCache.get(normalizedName);

        if (!genreId) {
          // Find or create genre
          const existingGenre = await prisma.genre.findFirst({
            where: { normalizedName },
            select: { id: true },
          });

          if (existingGenre) {
            genreId = existingGenre.id;
          } else {
            const newGenre = await prisma.genre.create({
              data: {
                name: genreName,
                normalizedName,
              },
              select: { id: true },
            });
            genreId = newGenre.id;
            genresCreated++;
          }

          genreCache.set(normalizedName, genreId);
        }

        // Check if link already exists
        const existingLink = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM _TrackGenres
          WHERE A = ${genreId} AND B = ${track.id}
        `;

        if (Number(existingLink[0]?.count) === 0) {
          // Create link in join table
          await prisma.$executeRaw`
            INSERT INTO _TrackGenres (A, B) VALUES (${genreId}, ${track.id})
          `;
          linksCreated++;
        }
      }
    }

    tracksProcessed += tracks.length;
    onProgress?.(tracksProcessed, totalTracks);
  }

  return { tracksProcessed, genresCreated, linksCreated };
}

/**
 * Migrate artist genres from string to multi-genre system (if needed in the future)
 */
export async function migrateArtistGenres(): Promise<{
  artistsProcessed: number;
  genresCreated: number;
}> {
  // This would be similar to migrateTrackGenres but for artists
  // Not implemented yet as artists still use a single genre string in the current schema
  throw new Error("Artist genre migration not yet implemented");
}

/**
 * Clean up: remove old genre string column after migration
 * WARNING: This is destructive and should only be run after confirming the migration is successful
 */
export async function removeOldGenreColumn(): Promise<void> {
  // This would require a new migration file to actually drop the column
  // For now, we just clear the values
  await prisma.track.updateMany({
    where: {
      OR: [{ genre: { not: null } }, { genre: { not: "" } }],
    },
    data: { genre: null },
  });
}

/**
 * Rollback migration: copy genres from join table back to genre string
 * This is useful for testing or if we need to revert the migration
 */
export async function rollbackGenreMigration(): Promise<{ tracksProcessed: number }> {
  let tracksProcessed = 0;

  // Get all tracks with genre links
  const tracks = await prisma.track.findMany({
    where: {
      genres: {
        some: {},
      },
    },
    select: {
      id: true,
      genres: {
        select: { name: true },
      },
    },
  });

  for (const track of tracks) {
    const genreString = track.genres.map((g) => g.name).join(", ");
    await prisma.track.update({
      where: { id: track.id },
      data: { genre: genreString },
    });
    tracksProcessed++;
  }

  return { tracksProcessed };
}
