import { createId } from "@paralleldrive/cuid2";
import { prisma } from "#app/utils/db.server";
import { type Prisma } from "#prisma/client.js";
import { type ExtractedAudioMetadata } from "./audio-metadata.server";
import { normalizeArtistName } from "./normalize.server.ts";

// Re-export the ADR-034 canonical normalization so every artist write path
// (create/edit/restore/split/import) derives the same normalizedName.
export { normalizeArtistName };

/**
 * Extract artist metadata from audio file metadata
 */
export function extractArtistMetadata(metadata: ExtractedAudioMetadata): {
  genre?: string;
  country?: string;
} {
  const genre = Array.isArray(metadata.genre)
    ? metadata.genre[0] || undefined
    : metadata.genre || undefined;

  return {
    genre,
    // Country is not typically in audio metadata, but we can extract it if available
    // For now, leave it undefined
  };
}

export type ArtistMetadata = {
  genre?: string;
  country?: string;
  bio?: string;
  imageUrl?: string;
  website?: string;
};

type ArtistLookup = {
  id: string;
  name: string;
  mergedIntoId: string | null;
};

type ArtistCreateData = {
  id: string;
  name: string;
  normalizedName: string;
  genre?: string;
  country?: string;
  bio?: string;
  imageUrl?: string;
  website?: string;
};

/**
 * Structural client for artist writes — accepts both the global `prisma` client
 * and a `Prisma.TransactionClient` so the shared core is client-agnostic.
 */
type ArtistClient = {
  artist: {
    findMany: (args: {
      where: { normalizedName: string };
      select: { id: true; name: true; normalizedName: true; mergedIntoId: true };
      orderBy: { createdAt: "asc" };
    }) => Promise<Array<ArtistLookup & { normalizedName: string }>>;
    findUnique: (args: {
      where: { id: string };
      select: { id: true; name: true; mergedIntoId: true };
    }) => Promise<ArtistLookup | null>;
    create: (args: {
      data: ArtistCreateData;
      select: { id: true; name: true };
    }) => Promise<{ id: string; name: string }>;
  };
};

/**
 * Follow mergedIntoId until we reach the living artist.
 * Upload/import must not keep attaching tracks to a merged-away source.
 */
async function resolveCanonicalArtist(
  db: ArtistClient,
  artist: ArtistLookup,
): Promise<{ id: string; name: string }> {
  const seen = new Set<string>();
  let current = artist;

  while (current.mergedIntoId) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);

    const next = await db.artist.findUnique({
      where: { id: current.mergedIntoId },
      select: { id: true, name: true, mergedIntoId: true },
    });
    if (!next) {
      break;
    }
    current = next;
  }

  return { id: current.id, name: current.name };
}

/**
 * Find all artists with matching normalized name
 */
export async function findArtistsByName(name: string): Promise<
  Array<{
    id: string;
    name: string;
    normalizedName: string;
    mergedIntoId: string | null;
  }>
> {
  const normalizedName = normalizeArtistName(name);
  if (!normalizedName) {
    return [];
  }

  return await prisma.artist.findMany({
    where: { normalizedName },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      mergedIntoId: true,
    },
    orderBy: { createdAt: "asc" }, // First match = oldest
  });
}

/**
 * Shared get-or-create core, parameterized by client (global `prisma` or a
 * transaction client).
 */
async function getOrCreateArtistCore(
  client: ArtistClient,
  name: string,
  metadata?: ArtistMetadata,
): Promise<{ id: string; name: string }> {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Artist name is required");
  }

  const normalizedName = normalizeArtistName(name);

  // Find existing artists with same normalized name
  const existingArtists = await client.artist.findMany({
    where: { normalizedName },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      mergedIntoId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingArtists.length > 0 && existingArtists[0]) {
    // Use first match (oldest), following any merge chain to the living artist
    return resolveCanonicalArtist(client, existingArtists[0]);
  }

  // Create new artist
  const artist = await client.artist.create({
    data: {
      id: createId(),
      name: name.trim(),
      normalizedName,
      ...(metadata?.genre && { genre: metadata.genre }),
      ...(metadata?.country && { country: metadata.country }),
      ...(metadata?.bio && { bio: metadata.bio }),
      ...(metadata?.imageUrl && { imageUrl: metadata.imageUrl }),
      ...(metadata?.website && { website: metadata.website }),
    },
    select: {
      id: true,
      name: true,
    },
  });

  return artist;
}

/**
 * Get or create an Artist record
 * Uses normalized name for matching
 * If multiple artists with same normalized name exist, uses the first match.
 * If that artist was merged, follows mergedIntoId to the living artist.
 */
export async function getOrCreateArtist(
  name: string,
  metadata?: ArtistMetadata,
): Promise<{ id: string; name: string }> {
  return getOrCreateArtistCore(prisma, name, metadata);
}

/**
 * Transaction-aware version of getOrCreateArtist
 * Accepts a Prisma transaction client
 */
export async function getOrCreateArtistTx(
  tx: Prisma.TransactionClient,
  name: string,
  metadata?: ArtistMetadata,
): Promise<{ id: string; name: string }> {
  return getOrCreateArtistCore(tx, name, metadata);
}
