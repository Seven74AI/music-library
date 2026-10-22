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

/**
 * The refresh job writes `NormalizedName` rows for every artist/album before it
 * saves `DuplicateDetection` pairs. Presence of a row for an entity type is the
 * signal that a detection pass has run, so an empty `DuplicateDetection` cache
 * means "no duplicates found" rather than "never ran".
 */
async function duplicateCacheIsAuthoritative(entityType: "artist" | "album"): Promise<boolean> {
  const row = await prisma.normalizedName.findFirst({
    where: { entityType },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Reconstruct artist duplicate groups from the `DuplicateDetection` cache.
 * ADR-034 mandates reading cached results on the hot path instead of re-running
 * the O(n²) live detection on every page view.
 */
export async function readArtistDuplicateGroupsFromCache(): Promise<{
  exact: ArtistDuplicateGroup[];
  fuzzy: ArtistDuplicateGroup[];
}> {
  const pairs = await prisma.duplicateDetection.findMany({
    where: { entityType: "artist", status: "pending" },
    select: { entityId1: true, entityId2: true, matchType: true, normalizedName: true },
  });

  if (pairs.length === 0) return { exact: [], fuzzy: [] };

  const entityIds = [...new Set(pairs.flatMap((pair) => [pair.entityId1, pair.entityId2]))];
  const artists = await prisma.artist.findMany({
    where: { id: { in: entityIds }, mergedIntoId: null },
    select: {
      id: true,
      name: true,
      _count: { select: { tracks: true, albums: true } },
    },
  });
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));

  const groups = new Map<
    string,
    { matchType: MatchType; normalizedName: string; ids: Set<string> }
  >();

  for (const pair of pairs) {
    if (!artistById.has(pair.entityId1) || !artistById.has(pair.entityId2)) continue;
    const matchType = pair.matchType as MatchType;
    const key = `${matchType}\u0000${pair.normalizedName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.add(pair.entityId1);
      existing.ids.add(pair.entityId2);
    } else {
      groups.set(key, {
        matchType,
        normalizedName: pair.normalizedName,
        ids: new Set([pair.entityId1, pair.entityId2]),
      });
    }
  }

  const exact: ArtistDuplicateGroup[] = [];
  const fuzzy: ArtistDuplicateGroup[] = [];

  for (const group of groups.values()) {
    if (group.ids.size < 2) continue;
    const artistList = [...group.ids]
      .map((id) => {
        const artist = artistById.get(id)!;
        return {
          id: artist.id,
          name: artist.name,
          trackCount: artist._count.tracks,
          albumCount: artist._count.albums,
        };
      })
      .sort((a, b) => b.trackCount - a.trackCount);

    const result: ArtistDuplicateGroup = {
      normalizedName: group.normalizedName,
      matchType: group.matchType,
      artists: artistList,
      totalTracks: artistList.reduce((sum, artist) => sum + artist.trackCount, 0),
      totalAlbums: artistList.reduce((sum, artist) => sum + artist.albumCount, 0),
    };
    (group.matchType === "exact" ? exact : fuzzy).push(result);
  }

  exact.sort((a, b) => b.totalTracks - a.totalTracks);
  fuzzy.sort((a, b) => b.totalTracks - a.totalTracks);

  return { exact, fuzzy };
}

/**
 * Reconstruct album duplicate groups from the `DuplicateDetection` cache.
 * Album groups are keyed by artistId + normalized name (see findExactAlbumDuplicates /
 * findFuzzyAlbumDuplicates) so same-named albums by different artists stay separate.
 */
export async function readAlbumDuplicateGroupsFromCache(): Promise<{
  exact: AlbumDuplicateGroup[];
  fuzzy: AlbumDuplicateGroup[];
}> {
  const pairs = await prisma.duplicateDetection.findMany({
    where: { entityType: "album", status: "pending" },
    select: { entityId1: true, entityId2: true, matchType: true, normalizedName: true },
  });

  if (pairs.length === 0) return { exact: [], fuzzy: [] };

  const entityIds = [...new Set(pairs.flatMap((pair) => [pair.entityId1, pair.entityId2]))];
  const albums = await prisma.album.findMany({
    where: { id: { in: entityIds }, mergedIntoId: null },
    select: {
      id: true,
      name: true,
      year: true,
      artistId: true,
      artist: { select: { id: true, name: true } },
      _count: { select: { tracks: true } },
    },
  });
  const albumById = new Map(albums.map((album) => [album.id, album]));

  const groups = new Map<
    string,
    {
      matchType: MatchType;
      normalizedName: string;
      artistId: string;
      artistName: string;
      ids: Set<string>;
    }
  >();

  for (const pair of pairs) {
    const first = albumById.get(pair.entityId1);
    const second = albumById.get(pair.entityId2);
    if (!first || !second) continue;
    if (first.artistId !== second.artistId) continue;

    const matchType = pair.matchType as MatchType;
    const key = `${matchType}\u0000${first.artistId}\u0000${pair.normalizedName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.add(pair.entityId1);
      existing.ids.add(pair.entityId2);
    } else {
      groups.set(key, {
        matchType,
        normalizedName: pair.normalizedName,
        artistId: first.artistId,
        artistName: first.artist.name,
        ids: new Set([pair.entityId1, pair.entityId2]),
      });
    }
  }

  const exact: AlbumDuplicateGroup[] = [];
  const fuzzy: AlbumDuplicateGroup[] = [];

  for (const group of groups.values()) {
    if (group.ids.size < 2) continue;
    const albumList = [...group.ids]
      .map((id) => {
        const album = albumById.get(id)!;
        return {
          id: album.id,
          name: album.name,
          year: album.year,
          trackCount: album._count.tracks,
        };
      })
      .sort((a, b) => b.trackCount - a.trackCount);

    const result: AlbumDuplicateGroup = {
      normalizedName: group.normalizedName,
      matchType: group.matchType,
      artistId: group.artistId,
      artistName: group.artistName,
      albums: albumList,
      totalTracks: albumList.reduce((sum, album) => sum + album.trackCount, 0),
    };
    (group.matchType === "exact" ? exact : fuzzy).push(result);
  }

  exact.sort((a, b) => b.totalTracks - a.totalTracks);
  fuzzy.sort((a, b) => b.totalTracks - a.totalTracks);

  return { exact, fuzzy };
}

/**
 * Album duplicate groups for the curator read path. Reads the ADR-034 cache;
 * on a cold start (refresh job never ran) it runs detection once and caches the
 * result so subsequent page views never re-run the O(n²) computation.
 */
export async function getAlbumDuplicateGroups(): Promise<{
  exact: AlbumDuplicateGroup[];
  fuzzy: AlbumDuplicateGroup[];
}> {
  if (await duplicateCacheIsAuthoritative("album")) {
    return readAlbumDuplicateGroupsFromCache();
  }

  const [exact, fuzzy] = await Promise.all([
    findExactAlbumDuplicates(),
    findFuzzyAlbumDuplicates(),
  ]);
  await saveDuplicateDetectionResults("album", exact, fuzzy);
  return { exact, fuzzy };
}

/**
 * Artist duplicate groups for the curator read path. Same cold-start
 * self-healing as getAlbumDuplicateGroups.
 */
export async function getArtistDuplicateGroups(): Promise<{
  exact: ArtistDuplicateGroup[];
  fuzzy: ArtistDuplicateGroup[];
}> {
  if (await duplicateCacheIsAuthoritative("artist")) {
    return readArtistDuplicateGroupsFromCache();
  }

  const [exact, fuzzy] = await Promise.all([
    findExactArtistDuplicates(),
    findFuzzyArtistDuplicates(),
  ]);
  await saveDuplicateDetectionResults("artist", exact, fuzzy);
  return { exact, fuzzy };
}
