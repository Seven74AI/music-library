/**
 * Duplicate detection utilities using Levenshtein distance
 * ADR-034: Duplicate Detection Algorithm
 */

import levenshtein from "js-levenshtein";
import { normalizeArtistName, normalizeAlbumName, isExactMatch } from "./normalize.server.ts";
import { prisma } from "./db.server.ts";

/**
 * Thresholds for fuzzy matching based on string length
 */
const FUZZY_THRESHOLD_SHORT = 2; // For names < 10 characters
const FUZZY_THRESHOLD_LONG = 3; // For names >= 10 characters

/**
 * Calculate similarity score between two normalized strings
 * Returns the Levenshtein distance (0 = exact match, higher = more different)
 */
export function calculateSimilarity(normalized1: string, normalized2: string): number {
  return levenshtein(normalized1, normalized2);
}

/**
 * Check if two normalized names are fuzzy matches
 */
export function isFuzzyMatch(normalized1: string, normalized2: string): boolean {
  const distance = calculateSimilarity(normalized1, normalized2);
  const threshold = normalized1.length < 10 ? FUZZY_THRESHOLD_SHORT : FUZZY_THRESHOLD_LONG;
  return distance > 0 && distance <= threshold;
}

/**
 * Match type for duplicate detection
 */
export type MatchType = "exact" | "fuzzy";

/**
 * Artist duplicate group
 */
export interface ArtistDuplicateGroup {
  normalizedName: string;
  matchType: MatchType;
  artists: Array<{
    id: string;
    name: string;
    trackCount: number;
    albumCount: number;
  }>;
  totalTracks: number;
  totalAlbums: number;
}

/**
 * Album entry within a duplicate group. `artistId`/`artistName` are carried
 * per-album so cross-artist fuzzy groups (which span multiple artists) can
 * render each album's own artist.
 */
export interface AlbumDuplicateEntry {
  id: string;
  name: string;
  year: number | null;
  artistId: string;
  artistName: string;
  trackCount: number;
}

/**
 * Album duplicate group
 */
export interface AlbumDuplicateGroup {
  normalizedName: string;
  matchType: MatchType;
  /**
   * `null` when the group spans multiple artists (cross-artist fuzzy match).
   * Set to the single artist for same-artist groups (exact + fuzzy).
   */
  artistId: string | null;
  artistName: string | null;
  albums: AlbumDuplicateEntry[];
  totalTracks: number;
}

/**
 * Find exact duplicate artists
 */
export async function findExactArtistDuplicates(): Promise<ArtistDuplicateGroup[]> {
  // Get all artists with their normalized names
  const artists = await prisma.artist.findMany({
    where: { mergedIntoId: null },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          tracks: true,
          albums: true,
        },
      },
    },
  });

  // Group by normalized name
  const groupedByNormalized = new Map<string, typeof artists>();

  for (const artist of artists) {
    const normalized = normalizeArtistName(artist.name);
    if (!normalized) continue;

    if (!groupedByNormalized.has(normalized)) {
      groupedByNormalized.set(normalized, []);
    }
    groupedByNormalized.get(normalized)!.push(artist);
  }

  // Filter to only groups with 2+ artists
  const duplicateGroups: ArtistDuplicateGroup[] = [];

  for (const [normalizedName, group] of groupedByNormalized) {
    if (group.length < 2) continue;

    const artistList = group.map((a) => ({
      id: a.id,
      name: a.name,
      trackCount: a._count.tracks,
      albumCount: a._count.albums,
    }));

    // Sort by track count descending (largest first)
    artistList.sort((a, b) => b.trackCount - a.trackCount);

    duplicateGroups.push({
      normalizedName,
      matchType: "exact",
      artists: artistList,
      totalTracks: artistList.reduce((sum, a) => sum + a.trackCount, 0),
      totalAlbums: artistList.reduce((sum, a) => sum + a.albumCount, 0),
    });
  }

  // Sort groups by total track count descending
  duplicateGroups.sort((a, b) => b.totalTracks - a.totalTracks);

  return duplicateGroups;
}

/**
 * Find fuzzy duplicate artists using Levenshtein distance
 * Uses blocking strategy (group by first 2 chars) to reduce comparisons
 */
export async function findFuzzyArtistDuplicates(): Promise<ArtistDuplicateGroup[]> {
  // Get all artists with their normalized names
  const artists = await prisma.artist.findMany({
    where: { mergedIntoId: null },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          tracks: true,
          albums: true,
        },
      },
    },
  });

  // Normalize and create lookup
  const artistsWithNormalized = artists.map((a) => ({
    ...a,
    normalized: normalizeArtistName(a.name),
  }));

  // Block by first 2 characters for efficiency
  const blocks = new Map<string, typeof artistsWithNormalized>();

  for (const artist of artistsWithNormalized) {
    if (!artist.normalized) continue;

    const blockKey = artist.normalized.slice(0, 2);
    if (!blocks.has(blockKey)) {
      blocks.set(blockKey, []);
    }
    blocks.get(blockKey)!.push(artist);
  }

  // Find fuzzy matches within blocks
  const fuzzyPairs = new Map<string, Set<string>>(); // normalizedName -> set of artist IDs

  for (const [, group] of blocks) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a1 = group[i];
        const a2 = group[j];

        if (!a1 || !a2) continue;

        // Skip if exact match (those are handled separately)
        if (isExactMatch(a1.normalized, a2.normalized)) continue;

        // Check if fuzzy match
        if (isFuzzyMatch(a1.normalized, a2.normalized)) {
          // Use the shorter normalized name as the group key
          const groupKey =
            a1.normalized.length <= a2.normalized.length ? a1.normalized : a2.normalized;

          if (!fuzzyPairs.has(groupKey)) {
            fuzzyPairs.set(groupKey, new Set());
          }
          fuzzyPairs.get(groupKey)!.add(a1.id);
          fuzzyPairs.get(groupKey)!.add(a2.id);
        }
      }
    }
  }

  // Build duplicate groups
  const duplicateGroups: ArtistDuplicateGroup[] = [];

  for (const [normalizedName, artistIds] of fuzzyPairs) {
    if (artistIds.size < 2) continue;

    const groupArtists = artistsWithNormalized.filter((a) => artistIds.has(a.id));

    const artistList = groupArtists.map((a) => ({
      id: a.id,
      name: a.name,
      trackCount: a._count.tracks,
      albumCount: a._count.albums,
    }));

    // Sort by track count descending
    artistList.sort((a, b) => b.trackCount - a.trackCount);

    duplicateGroups.push({
      normalizedName,
      matchType: "fuzzy",
      artists: artistList,
      totalTracks: artistList.reduce((sum, a) => sum + a.trackCount, 0),
      totalAlbums: artistList.reduce((sum, a) => sum + a.albumCount, 0),
    });
  }

  // Sort groups by total track count descending
  duplicateGroups.sort((a, b) => b.totalTracks - a.totalTracks);

  return duplicateGroups;
}

/**
 * Find exact duplicate albums (same artist, same normalized name)
 */
export async function findExactAlbumDuplicates(): Promise<AlbumDuplicateGroup[]> {
  // Get all albums with their artists
  const albums = await prisma.album.findMany({
    where: { mergedIntoId: null },
    select: {
      id: true,
      name: true,
      year: true,
      artistId: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  // Group by artistId + normalized album name
  const groupedByArtistAndName = new Map<string, typeof albums>();

  for (const album of albums) {
    const normalized = normalizeAlbumName(album.name);
    if (!normalized) continue;

    const groupKey = `${album.artistId}:${normalized}`;
    if (!groupedByArtistAndName.has(groupKey)) {
      groupedByArtistAndName.set(groupKey, []);
    }
    groupedByArtistAndName.get(groupKey)!.push(album);
  }

  // Filter to only groups with 2+ albums
  const duplicateGroups: AlbumDuplicateGroup[] = [];

  for (const [groupKey, group] of groupedByArtistAndName) {
    if (group.length < 2) continue;

    const [, normalizedName] = groupKey.split(":");
    const firstAlbum = group[0];

    if (!firstAlbum || !normalizedName) continue;

    const albumList = group.map((a) => ({
      id: a.id,
      name: a.name,
      year: a.year,
      artistId: a.artistId,
      artistName: a.artist.name,
      trackCount: a._count.tracks,
    }));

    // Sort by track count descending
    albumList.sort((a, b) => b.trackCount - a.trackCount);

    duplicateGroups.push({
      normalizedName,
      matchType: "exact",
      artistId: firstAlbum.artistId,
      artistName: firstAlbum.artist.name,
      albums: albumList,
      totalTracks: albumList.reduce((sum, a) => sum + a.trackCount, 0),
    });
  }

  // Sort groups by total track count descending
  duplicateGroups.sort((a, b) => b.totalTracks - a.totalTracks);

  return duplicateGroups;
}

type AlbumWithArtist = {
  id: string;
  name: string;
  year: number | null;
  artistId: string;
  artist: { id: string; name: string };
  _count: { tracks: number };
};

type NormalizedAlbum = AlbumWithArtist & {
  normalized: string;
  artistNormalized: string;
};

/**
 * Build an AlbumDuplicateGroup from a set of album ids.
 * `artistId`/`artistName` are `null` for cross-artist groups.
 */
function buildAlbumDuplicateGroup(
  albums: NormalizedAlbum[],
  albumIds: Set<string>,
  normalizedName: string,
  matchType: MatchType,
  artistId: string | null,
  artistName: string | null,
): AlbumDuplicateGroup | null {
  const groupAlbums = albums.filter((a) => albumIds.has(a.id));
  if (groupAlbums.length < 2) return null;

  const albumList = groupAlbums.map((a) => ({
    id: a.id,
    name: a.name,
    year: a.year,
    artistId: a.artistId,
    artistName: a.artist.name,
    trackCount: a._count.tracks,
  }));

  // Sort by track count descending
  albumList.sort((a, b) => b.trackCount - a.trackCount);

  return {
    normalizedName,
    matchType,
    artistId,
    artistName,
    albums: albumList,
    totalTracks: albumList.reduce((sum, a) => sum + a.trackCount, 0),
  };
}

/**
 * Find fuzzy duplicate albums:
 * - same artist + similar name, OR
 * - similar artist + similar name + year within ±2 (cross-artist)
 */
export async function findFuzzyAlbumDuplicates(): Promise<AlbumDuplicateGroup[]> {
  const albums = await prisma.album.findMany({
    where: { mergedIntoId: null },
    select: {
      id: true,
      name: true,
      year: true,
      artistId: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  // Normalize album + artist names once
  const albumsWithNormalized: NormalizedAlbum[] = albums.map((a) => ({
    ...a,
    normalized: normalizeAlbumName(a.name),
    artistNormalized: normalizeArtistName(a.artist.name),
  }));

  const duplicateGroups: AlbumDuplicateGroup[] = [];

  // Branch 1: same artist + similar name
  const albumsByArtist = new Map<string, NormalizedAlbum[]>();
  for (const album of albumsWithNormalized) {
    if (!albumsByArtist.has(album.artistId)) {
      albumsByArtist.set(album.artistId, []);
    }
    albumsByArtist.get(album.artistId)!.push(album);
  }

  for (const [artistId, artistAlbums] of albumsByArtist) {
    if (artistAlbums.length < 2) continue;

    const fuzzyPairs = new Map<string, Set<string>>();
    for (let i = 0; i < artistAlbums.length; i++) {
      for (let j = i + 1; j < artistAlbums.length; j++) {
        const a1 = artistAlbums[i];
        const a2 = artistAlbums[j];
        if (!a1 || !a2) continue;
        if (!a1.normalized || !a2.normalized) continue;
        if (isExactMatch(a1.normalized, a2.normalized)) continue;
        if (!isFuzzyMatch(a1.normalized, a2.normalized)) continue;

        const groupKey =
          a1.normalized.length <= a2.normalized.length ? a1.normalized : a2.normalized;
        if (!fuzzyPairs.has(groupKey)) fuzzyPairs.set(groupKey, new Set());
        fuzzyPairs.get(groupKey)!.add(a1.id);
        fuzzyPairs.get(groupKey)!.add(a2.id);
      }
    }

    for (const [normalizedName, albumIds] of fuzzyPairs) {
      const group = buildAlbumDuplicateGroup(
        artistAlbums,
        albumIds,
        normalizedName,
        "fuzzy",
        artistId,
        artistAlbums[0]?.artist.name ?? null,
      );
      if (group) duplicateGroups.push(group);
    }
  }

  // Branch 2: similar artist + similar name + year within ±2 (cross-artist).
  // Block by first 2 chars of the normalized album name to bound comparisons.
  const blocks = new Map<string, NormalizedAlbum[]>();
  for (const album of albumsWithNormalized) {
    if (!album.normalized) continue;
    const blockKey = album.normalized.slice(0, 2);
    if (!blocks.has(blockKey)) blocks.set(blockKey, []);
    blocks.get(blockKey)!.push(album);
  }

  const crossArtistPairs = new Map<string, Set<string>>();
  for (const [, block] of blocks) {
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const a1 = block[i];
        const a2 = block[j];
        if (!a1 || !a2) continue;
        // Same artist is handled in branch 1
        if (a1.artistId === a2.artistId) continue;
        if (!a1.normalized || !a2.normalized) continue;
        if (isExactMatch(a1.normalized, a2.normalized)) continue;
        if (!isFuzzyMatch(a1.normalized, a2.normalized)) continue;
        if (!a1.artistNormalized || !a2.artistNormalized) continue;
        if (!isFuzzyMatch(a1.artistNormalized, a2.artistNormalized)) continue;
        // Year must be within ±2 (both present)
        if (a1.year == null || a2.year == null) continue;
        if (Math.abs(a1.year - a2.year) > 2) continue;

        const groupKey =
          a1.normalized.length <= a2.normalized.length ? a1.normalized : a2.normalized;
        if (!crossArtistPairs.has(groupKey)) crossArtistPairs.set(groupKey, new Set());
        crossArtistPairs.get(groupKey)!.add(a1.id);
        crossArtistPairs.get(groupKey)!.add(a2.id);
      }
    }
  }

  for (const [normalizedName, albumIds] of crossArtistPairs) {
    const group = buildAlbumDuplicateGroup(
      albumsWithNormalized,
      albumIds,
      normalizedName,
      "fuzzy",
      null,
      null,
    );
    if (group) duplicateGroups.push(group);
  }

  // Sort groups by total track count descending
  duplicateGroups.sort((a, b) => b.totalTracks - a.totalTracks);

  return duplicateGroups;
}

/**
 * Cache artist normalized names in the database
 */
export async function cacheArtistNormalizedNames(): Promise<void> {
  const artists = await prisma.artist.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  for (const artist of artists) {
    const normalizedName = normalizeArtistName(artist.name);
    if (!normalizedName) continue;

    await prisma.normalizedName.upsert({
      where: {
        entityType_entityId: {
          entityType: "artist",
          entityId: artist.id,
        },
      },
      update: {
        originalName: artist.name,
        normalizedName,
        updatedAt: new Date(),
      },
      create: {
        entityType: "artist",
        entityId: artist.id,
        originalName: artist.name,
        normalizedName,
      },
    });
  }
}

/**
 * Cache album normalized names in the database
 */
export async function cacheAlbumNormalizedNames(): Promise<void> {
  const albums = await prisma.album.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  for (const album of albums) {
    const normalizedName = normalizeAlbumName(album.name);
    if (!normalizedName) continue;

    await prisma.normalizedName.upsert({
      where: {
        entityType_entityId: {
          entityType: "album",
          entityId: album.id,
        },
      },
      update: {
        originalName: album.name,
        normalizedName,
        updatedAt: new Date(),
      },
      create: {
        entityType: "album",
        entityId: album.id,
        originalName: album.name,
        normalizedName,
      },
    });
  }
}

/**
 * Save duplicate detection results to database
 */
export async function saveDuplicateDetectionResults(
  entityType: "artist" | "album",
  exactGroups: ArtistDuplicateGroup[] | AlbumDuplicateGroup[],
  fuzzyGroups: ArtistDuplicateGroup[] | AlbumDuplicateGroup[],
): Promise<void> {
  // Delete existing detection records for this entity type
  await prisma.duplicateDetection.deleteMany({
    where: { entityType },
  });

  // Save exact matches
  for (const group of exactGroups) {
    const entities = "artists" in group ? group.artists : group.albums;

    for (let i = 0; i < entities.length; i++) {
      const entity1 = entities[i];
      if (!entity1) continue;

      for (let j = i + 1; j < entities.length; j++) {
        const entity2 = entities[j];
        if (!entity2) continue;

        await prisma.duplicateDetection.create({
          data: {
            entityType,
            entityId1: entity1.id,
            entityId2: entity2.id,
            matchType: "exact",
            similarity: 0,
            normalizedName: group.normalizedName,
            status: "pending",
          },
        });
      }
    }
  }

  // Save fuzzy matches
  for (const group of fuzzyGroups) {
    const entities = "artists" in group ? group.artists : group.albums;

    for (let i = 0; i < entities.length; i++) {
      const entity1 = entities[i];
      if (!entity1) continue;

      for (let j = i + 1; j < entities.length; j++) {
        const entity2 = entities[j];
        if (!entity2) continue;

        const normalized1 =
          entityType === "artist"
            ? normalizeArtistName(entity1.name)
            : normalizeAlbumName(entity1.name);
        const normalized2 =
          entityType === "artist"
            ? normalizeArtistName(entity2.name)
            : normalizeAlbumName(entity2.name);

        const similarity = calculateSimilarity(normalized1, normalized2);

        await prisma.duplicateDetection.create({
          data: {
            entityType,
            entityId1: entity1.id,
            entityId2: entity2.id,
            matchType: "fuzzy",
            similarity,
            normalizedName: group.normalizedName,
            status: "pending",
          },
        });
      }
    }
  }
}
