/**
 * Genre migration helpers with no Prisma / generated-client dependency.
 */

export const DROP_TRACK_GENRE_MIGRATION = "20261108160000_drop_track_genre";

/**
 * Normalize a genre name for deduplication and comparison
 */
export function normalizeGenreName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
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

  const genres = genreString
    .split(/[,;/]/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map((g) => {
      return g
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    });

  const uniqueGenres = Array.from(new Map(genres.map((g) => [normalizeGenreName(g), g])).values());

  return uniqueGenres;
}

export type MigrateTrackGenresStore = {
  trackGenreColumnExists(): boolean | Promise<boolean>;
  countTracksWithLegacyGenre(): number | Promise<number>;
  fetchTrackGenreBatch(
    limit: number,
    offset: number,
  ): Array<{ id: string; genre: string }> | Promise<Array<{ id: string; genre: string }>>;
  findGenreIdByNormalizedName(
    normalizedName: string,
  ): string | undefined | Promise<string | undefined>;
  createGenre(name: string, normalizedName: string): string | Promise<string>;
  insertTrackGenreLink(genreId: string, trackId: string): boolean | Promise<boolean>;
};

async function resolve<T>(value: T | Promise<T>): Promise<T> {
  return await value;
}

export async function migrateTrackGenresWithStore(
  store: MigrateTrackGenresStore,
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<{ tracksProcessed: number; genresCreated: number; linksCreated: number }> {
  const { batchSize = 100, onProgress } = options;

  if (!(await resolve(store.trackGenreColumnExists()))) {
    return { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 };
  }

  const totalTracks = await resolve(store.countTracksWithLegacyGenre());

  let tracksProcessed = 0;
  let genresCreated = 0;
  let linksCreated = 0;

  const genreCache = new Map<string, string>();

  while (tracksProcessed < totalTracks) {
    const tracks = await resolve(store.fetchTrackGenreBatch(batchSize, tracksProcessed));

    if (tracks.length === 0) break;

    for (const track of tracks) {
      const genreNames = parseGenreString(track.genre);

      for (const genreName of genreNames) {
        const normalizedName = normalizeGenreName(genreName);

        let genreId = genreCache.get(normalizedName);

        if (!genreId) {
          const existingId = await resolve(store.findGenreIdByNormalizedName(normalizedName));
          if (existingId) {
            genreId = existingId;
          } else {
            genreId = await resolve(store.createGenre(genreName, normalizedName));
            genresCreated++;
          }
          genreCache.set(normalizedName, genreId);
        }

        if (await resolve(store.insertTrackGenreLink(genreId, track.id))) {
          linksCreated++;
        }
      }
    }

    tracksProcessed += tracks.length;
    onProgress?.(tracksProcessed, totalTracks);
  }

  return { tracksProcessed, genresCreated, linksCreated };
}
