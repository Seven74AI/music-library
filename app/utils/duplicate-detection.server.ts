/**
 * Duplicate detection utilities using Levenshtein distance
 * ADR-034: Duplicate Detection Algorithm
 */

import levenshtein from "js-levenshtein";
import { chunkArray } from "./chunk-array";
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
 * Album duplicate group
 */
export interface AlbumDuplicateGroup {
  normalizedName: string;
  matchType: MatchType;
  artistId: string;
  artistName: string;
  albums: Array<{
    id: string;
    name: string;
    year: number | null;
    trackCount: number;
  }>;
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

/**
 * Find fuzzy duplicate albums (same artist, similar names)
 */
export async function findFuzzyAlbumDuplicates(): Promise<AlbumDuplicateGroup[]> {
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

  // Group by artist first
  const albumsByArtist = new Map<string, typeof albums>();

  for (const album of albums) {
    if (!albumsByArtist.has(album.artistId)) {
      albumsByArtist.set(album.artistId, []);
    }
    albumsByArtist.get(album.artistId)!.push(album);
  }

  // Find fuzzy matches within each artist
  const duplicateGroups: AlbumDuplicateGroup[] = [];

  for (const [artistId, artistAlbums] of albumsByArtist) {
    if (artistAlbums.length < 2) continue;

    // Normalize album names
    const albumsWithNormalized = artistAlbums.map((a) => ({
      ...a,
      normalized: normalizeAlbumName(a.name),
    }));

    // Find fuzzy matches
    const fuzzyPairs = new Map<string, Set<string>>();

    for (let i = 0; i < albumsWithNormalized.length; i++) {
      for (let j = i + 1; j < albumsWithNormalized.length; j++) {
        const a1 = albumsWithNormalized[i];
        const a2 = albumsWithNormalized[j];

        if (!a1 || !a2) continue;

        // Skip if no normalized names
        if (!a1.normalized || !a2.normalized) continue;

        // Skip if exact match (handled separately)
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

    // Build duplicate groups for this artist
    for (const [normalizedName, albumIds] of fuzzyPairs) {
      if (albumIds.size < 2) continue;

      const groupAlbums = albumsWithNormalized.filter((a) => albumIds.has(a.id));

      if (groupAlbums.length === 0) continue;
      const firstAlbum = groupAlbums[0];
      if (!firstAlbum) continue;

      const albumList = groupAlbums.map((a) => ({
        id: a.id,
        name: a.name,
        year: a.year,
        trackCount: a._count.tracks,
      }));

      // Sort by track count descending
      albumList.sort((a, b) => b.trackCount - a.trackCount);

      duplicateGroups.push({
        normalizedName,
        matchType: "fuzzy",
        artistId,
        artistName: firstAlbum.artist.name,
        albums: albumList,
        totalTracks: albumList.reduce((sum, a) => sum + a.trackCount, 0),
      });
    }
  }

  // Sort groups by total track count descending
  duplicateGroups.sort((a, b) => b.totalTracks - a.totalTracks);

  return duplicateGroups;
}

/**
 * Replace the normalized-name cache for one entity type in a single transaction:
 * clear the existing rows, then bulk-insert the recomputed rows.
 */
async function replaceNormalizedNames(
  entityType: "artist" | "album",
  rows: Array<{
    entityType: string;
    entityId: string;
    originalName: string;
    normalizedName: string;
  }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.normalizedName.deleteMany({ where: { entityType } }),
    ...chunkArray(rows).map((chunk) => prisma.normalizedName.createMany({ data: chunk })),
  ]);
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

  const rows: Array<{
    entityType: string;
    entityId: string;
    originalName: string;
    normalizedName: string;
  }> = [];

  for (const artist of artists) {
    const normalizedName = normalizeArtistName(artist.name);
    if (!normalizedName) continue;

    rows.push({
      entityType: "artist",
      entityId: artist.id,
      originalName: artist.name,
      normalizedName,
    });
  }

  await replaceNormalizedNames("artist", rows);
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

  const rows: Array<{
    entityType: string;
    entityId: string;
    originalName: string;
    normalizedName: string;
  }> = [];

  for (const album of albums) {
    const normalizedName = normalizeAlbumName(album.name);
    if (!normalizedName) continue;

    rows.push({
      entityType: "album",
      entityId: album.id,
      originalName: album.name,
      normalizedName,
    });
  }

  await replaceNormalizedNames("album", rows);
}

/**
 * Save duplicate detection results to database
 */
export async function saveDuplicateDetectionResults(
  entityType: "artist" | "album",
  exactGroups: ArtistDuplicateGroup[] | AlbumDuplicateGroup[],
  fuzzyGroups: ArtistDuplicateGroup[] | AlbumDuplicateGroup[],
): Promise<void> {
  const rows: Array<{
    entityType: string;
    entityId1: string;
    entityId2: string;
    matchType: string;
    similarity: number;
    normalizedName: string;
    status: string;
  }> = [];

  // Build exact-match pairs
  for (const group of exactGroups) {
    const entities = "artists" in group ? group.artists : group.albums;

    for (let i = 0; i < entities.length; i++) {
      const entity1 = entities[i];
      if (!entity1) continue;

      for (let j = i + 1; j < entities.length; j++) {
        const entity2 = entities[j];
        if (!entity2) continue;

        rows.push({
          entityType,
          entityId1: entity1.id,
          entityId2: entity2.id,
          matchType: "exact",
          similarity: 0,
          normalizedName: group.normalizedName,
          status: "pending",
        });
      }
    }
  }

  // Build fuzzy-match pairs
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

        rows.push({
          entityType,
          entityId1: entity1.id,
          entityId2: entity2.id,
          matchType: "fuzzy",
          similarity,
          normalizedName: group.normalizedName,
          status: "pending",
        });
      }
    }
  }

  // Clear previous results and bulk-insert all pairs in chunked createMany calls.
  await prisma.$transaction([
    prisma.duplicateDetection.deleteMany({ where: { entityType } }),
    ...chunkArray(rows).map((chunk) => prisma.duplicateDetection.createMany({ data: chunk })),
  ]);
}
