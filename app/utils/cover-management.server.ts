// @context7: crypto, dns, net, Buffer, Prisma, sharp
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { prisma } from "#app/utils/db.server";
import { type Prisma } from "#prisma/client.js";
import { uploadFile } from "./storage.server";

/** Per-attempt timeout for external cover downloads (YouTube thumbnails, etc.) */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;

/** Retry transient network/timeout failures a few times before giving up */
export const IMAGE_DOWNLOAD_MAX_ATTEMPTS = 3;

/** Redirect hops to follow. Each hop is resolved and checked before connecting. */
const IMAGE_DOWNLOAD_MAX_REDIRECTS = 3;

const IMAGE_DOWNLOAD_RETRY_BASE_DELAY_MS = 1_000;

const blockedImageAddresses = new BlockList();
blockedImageAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedImageAddresses.addSubnet("192.168.0.0", 16, "ipv4");
// Link-local, including cloud metadata (169.254.169.254 and 169.254.170.2).
blockedImageAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedImageAddresses.addAddress("::1", "ipv6");
blockedImageAddresses.addSubnet("fe80::", 10, "ipv6");
blockedImageAddresses.addSubnet("fc00::", 7, "ipv6");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetriableImageDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch")
  );
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Node's URL.hostname keeps the brackets around IPv6 addresses. */
function hostnameForResolution(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isBlockedImageAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return blockedImageAddresses.check(normalized, "ipv4");
  if (family === 6) return blockedImageAddresses.check(normalized, "ipv6");
  return true;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch (error) {
    // Undici previously surfaced resolver failures as "fetch failed", which retries.
    throw new Error("fetch failed", { cause: error });
  }
}

/**
 * Accept only https URLs whose resolved addresses are public.
 * Returns null for policy rejections so they are not retried.
 */
async function validatePublicHttpsUrl(rawUrl: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn(`Refusing invalid image URL: ${rawUrl}`);
    return null;
  }

  if (url.protocol !== "https:") {
    console.warn(`Refusing non-https image URL: ${rawUrl}`);
    return null;
  }

  const hostname = hostnameForResolution(url.hostname);
  if (!hostname) {
    console.warn(`Refusing invalid image URL: ${rawUrl}`);
    return null;
  }

  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0 || addresses.some((address) => isBlockedImageAddress(address))) {
    console.warn(`Refusing non-public image URL: ${rawUrl}`);
    return null;
  }

  return url;
}

async function readDownloadedImage(
  response: Response,
  url: string,
  maxSize: number,
): Promise<Buffer | null> {
  if (!response.ok) {
    console.warn(`Failed to download image from ${url}: ${response.status} ${response.statusText}`);
    return null;
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("image/")) {
    console.warn(`Invalid content type for image from ${url}: ${contentType}`);
    return null;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    console.warn(`Image from ${url} exceeds max size: ${contentLength} bytes`);
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > maxSize) {
    console.warn(`Image from ${url} exceeds max size: ${buffer.length} bytes`);
    return null;
  }

  return buffer;
}

async function downloadExternalImageOnce(url: string, maxSize: number): Promise<Buffer | null> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= IMAGE_DOWNLOAD_MAX_REDIRECTS; redirectCount++) {
    const safeUrl = await validatePublicHttpsUrl(currentUrl);
    if (!safeUrl) return null;

    const response = await fetch(safeUrl.href, {
      signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return readDownloadedImage(response, safeUrl.href, maxSize);
    }

    if (redirectCount === IMAGE_DOWNLOAD_MAX_REDIRECTS) {
      console.warn(`Too many redirects while downloading image from ${url}`);
      return null;
    }

    const location = response.headers.get("location");
    if (!location) {
      console.warn(`Redirect from ${safeUrl.href} is missing a location`);
      return null;
    }

    try {
      currentUrl = new URL(location, safeUrl).href;
    } catch {
      console.warn(`Redirect from ${safeUrl.href} has an invalid location`);
      return null;
    }
  }

  return null;
}

/**
 * Download image from an external https URL.
 *
 * Loopback, link-local (including cloud metadata), and private addresses are
 * rejected before the request and again on every redirect. At most 3 redirects
 * are followed. YouTube thumbnail hosts such as i.ytimg.com and img.youtube.com
 * still download when they resolve to public addresses.
 *
 * @param url - External image URL (e.g., YouTube thumbnail)
 * @param maxSize - Maximum file size in bytes (default: 5MB)
 * @returns Image buffer or null if download fails
 */
export async function downloadExternalImage(
  url: string,
  maxSize: number = 5 * 1024 * 1024, // 5MB default
): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= IMAGE_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      return await downloadExternalImageOnce(url, maxSize);
    } catch (error) {
      const isLastAttempt = attempt === IMAGE_DOWNLOAD_MAX_ATTEMPTS;
      if (isLastAttempt || !isRetriableImageDownloadError(error)) {
        console.warn(`Error downloading image from ${url}:`, error);
        return null;
      }

      console.warn(
        `Retrying cover download for ${url} (attempt ${attempt}/${IMAGE_DOWNLOAD_MAX_ATTEMPTS})`,
      );
      await sleep(IMAGE_DOWNLOAD_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  return null;
}

/**
 * Calculate SHA-256 hash of image buffer for deduplication
 */
export async function calculateImageHash(buffer: Buffer): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}

type AlbumLookup = {
  id: string;
  mergedIntoId: string | null;
};

type AlbumDb = {
  album: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; mergedIntoId: true };
    }) => Promise<AlbumLookup | null>;
  };
};

/**
 * Follow mergedIntoId until we reach the living album.
 * Upload/import must not keep attaching tracks to a merged-away source.
 */
async function resolveCanonicalAlbum(db: AlbumDb, album: AlbumLookup): Promise<{ id: string }> {
  const seen = new Set<string>();
  let current = album;

  while (current.mergedIntoId) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);

    const next = await db.album.findUnique({
      where: { id: current.mergedIntoId },
      select: { id: true, mergedIntoId: true },
    });
    if (!next) {
      break;
    }
    current = next;
  }

  return { id: current.id };
}

/**
 * Get or create an Album record
 * Uses (artistId, name) as unique identifier
 */
export async function getOrCreateAlbum(
  artistId: string,
  albumName: string | null | undefined,
  year?: number | null,
): Promise<{ id: string } | null> {
  if (!albumName) {
    return null;
  }

  // Try to find existing album first
  let album = await prisma.album.findFirst({
    where: {
      artistId,
      name: albumName,
    },
    select: {
      id: true,
      mergedIntoId: true,
    },
  });

  // If not found, create it
  if (!album) {
    album = await prisma.album.create({
      data: {
        name: albumName,
        artistId,
        ...(year && { year }),
      },
      select: {
        id: true,
        mergedIntoId: true,
      },
    });
  }

  return resolveCanonicalAlbum(prisma, album);
}

/**
 * Transaction-aware version of getOrCreateAlbum
 */
export async function getOrCreateAlbumTx(
  tx: Prisma.TransactionClient,
  artistId: string,
  albumName: string | null | undefined,
  year?: number | null,
): Promise<{ id: string } | null> {
  if (!albumName) {
    return null;
  }

  // Try to find existing album first
  let album = await tx.album.findFirst({
    where: {
      artistId,
      name: albumName,
    },
    select: {
      id: true,
      mergedIntoId: true,
    },
  });

  // If not found, create it
  if (!album) {
    album = await tx.album.create({
      data: {
        name: albumName,
        artistId,
        ...(year && { year }),
      },
      select: {
        id: true,
        mergedIntoId: true,
      },
    });
  }

  return resolveCanonicalAlbum(tx, album);
}

/**
 * Associate a cover image with an album
 */
export async function associateCoverWithAlbum(
  coverImageId: string,
  albumId: string,
): Promise<void> {
  await prisma.album.update({
    where: { id: albumId },
    data: { coverImageId },
  });
}

/**
 * Transaction-aware version of associateCoverWithAlbum
 */
export async function associateCoverWithAlbumTx(
  tx: Prisma.TransactionClient,
  coverImageId: string,
  albumId: string,
): Promise<void> {
  await tx.album.update({
    where: { id: albumId },
    data: { coverImageId },
  });
}

/**
 * Find or create a cover image with deduplication
 *
 * Strategy:
 * 1. Calculate hash of image data
 * 2. Check if cover with same hash exists → reuse
 * 3. If album provided, check if album already has a cover → reuse album's cover
 * 4. Otherwise, upload new cover and create record
 *
 * @param params - Cover image parameters
 * @returns CoverImage record
 */
export async function findOrCreateCoverImage(params: {
  imageBuffer: Buffer;
  albumId?: string | null;
  trackId?: string;
  width?: number;
  height?: number;
  format?: string;
}): Promise<{ id: string; objectKey: string }> {
  const { imageBuffer, albumId, trackId, width, height, format } = params;

  // Step 1: Calculate hash
  const contentHash = await calculateImageHash(imageBuffer);

  // Step 2: Check if cover with same hash exists
  const existingCover = await prisma.coverImage.findUnique({
    where: { contentHash },
    select: { id: true, objectKey: true },
  });

  if (existingCover) {
    // Reuse existing cover
    // If album provided and doesn't have a cover, associate it
    if (albumId) {
      const album = await prisma.album.findUnique({
        where: { id: albumId },
        select: { coverImageId: true },
      });
      if (album && !album.coverImageId) {
        await associateCoverWithAlbum(existingCover.id, albumId);
      }
    }
    return existingCover;
  }

  // Step 3: If album provided, check if album already has a cover
  if (albumId) {
    const album = await prisma.album.findUnique({
      where: { id: albumId },
      include: { coverImage: { select: { id: true, objectKey: true } } },
    });

    if (album?.coverImage) {
      // Album already has a cover, reuse it
      return {
        id: album.coverImage.id,
        objectKey: album.coverImage.objectKey,
      };
    }
  }

  // Step 4: Upload new cover and create record
  // Import sharp dynamically (only when needed)
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) {
    throw new Error("sharp is not available for image processing");
  }

  // Process image: resize to max 1000x1000, convert to JPEG, optimize
  const processedImage = await sharp
    .default(imageBuffer)
    .resize(1000, 1000, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  // Get image metadata for dimensions
  const metadata = await sharp.default(processedImage).metadata();
  const finalWidth = width || metadata.width || null;
  const finalHeight = height || metadata.height || null;
  const finalFormat = format || "jpeg";
  const fileSize = processedImage.length;

  // Generate storage key
  const { createId } = await import("@paralleldrive/cuid2");
  const fileId = createId();
  const timestamp = Date.now();
  const objectKey = trackId
    ? `images/tracks/${trackId}/cover/${timestamp}-${fileId}.jpg`
    : `images/covers/${timestamp}-${fileId}.jpg`;

  // Upload to storage
  await uploadFile({
    file: processedImage,
    key: objectKey,
    contentType: "image/jpeg",
    metadata: {
      ...(trackId && { trackId }),
      type: "album-art",
      contentHash,
    },
  });

  // Create cover image record
  const coverImage = await prisma.coverImage.create({
    data: {
      contentHash,
      objectKey,
      width: finalWidth,
      height: finalHeight,
      format: finalFormat,
      fileSize,
    },
    select: {
      id: true,
      objectKey: true,
    },
  });

  // Associate with album if provided
  if (albumId) {
    await associateCoverWithAlbum(coverImage.id, albumId);
  }

  return coverImage;
}

export type CoverImageUploadParams = {
  imageBuffer: Buffer;
  albumId?: string | null;
  trackId?: string;
  width?: number;
  height?: number;
  format?: string;
};

/**
 * Result of {@link prepareCoverImageUpload}: the Tigris cover object has been
 * resolved and — when new — uploaded. `kind` tells the DB step whether to create
 * a new CoverImage row or reuse an existing one.
 */
export type PreparedCoverImage =
  | { kind: "existing"; id: string; objectKey: string }
  | { kind: "album-cover"; id: string; objectKey: string }
  | {
      kind: "new";
      objectKey: string;
      contentHash: string;
      width: number | null;
      height: number | null;
      format: string;
      fileSize: number;
    };

/**
 * Resolve the Tigris cover object for an image, uploading it when it is new.
 *
 * This performs the content-hash and album-has-cover dedup checks, then — when
 * the image is new — processes it with sharp and uploads it to Tigris. It uses
 * the global `prisma` client and runs entirely OUTSIDE any database transaction,
 * so a slow (or failing) sharp/upload never holds a SQLite write lock and can
 * never be rolled back after the object is already in storage. Callers that need
 * the CoverImage row created atomically with other writes should call
 * {@link createCoverImageInTx} with the returned {@link PreparedCoverImage}
 * inside their transaction.
 */
export async function prepareCoverImageUpload(
  params: CoverImageUploadParams,
): Promise<PreparedCoverImage> {
  const { imageBuffer, albumId, trackId, width, height, format } = params;

  // Step 1: Calculate hash for deduplication
  const contentHash = await calculateImageHash(imageBuffer);

  // Step 2: Check if a cover with the same hash already exists
  const existingCover = await prisma.coverImage.findUnique({
    where: { contentHash },
    select: { id: true, objectKey: true },
  });

  if (existingCover) {
    return { kind: "existing", id: existingCover.id, objectKey: existingCover.objectKey };
  }

  // Step 3: If the album already has a cover, reuse it (skip upload)
  if (albumId) {
    const album = await prisma.album.findUnique({
      where: { id: albumId },
      include: { coverImage: { select: { id: true, objectKey: true } } },
    });

    if (album?.coverImage) {
      return {
        kind: "album-cover",
        id: album.coverImage.id,
        objectKey: album.coverImage.objectKey,
      };
    }
  }

  // Step 4: Process and upload the new cover (outside any DB transaction)
  const sharp = await import("sharp").catch(() => null);
  if (!sharp) {
    throw new Error("sharp is not available for image processing");
  }

  const processedImage = await sharp
    .default(imageBuffer)
    .resize(1000, 1000, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  const metadata = await sharp.default(processedImage).metadata();
  const finalWidth = width || metadata.width || null;
  const finalHeight = height || metadata.height || null;
  const finalFormat = format || "jpeg";
  const fileSize = processedImage.length;

  const { createId } = await import("@paralleldrive/cuid2");
  const fileId = createId();
  const timestamp = Date.now();
  const objectKey = trackId
    ? `images/tracks/${trackId}/cover/${timestamp}-${fileId}.jpg`
    : `images/covers/${timestamp}-${fileId}.jpg`;

  await uploadFile({
    file: processedImage,
    key: objectKey,
    contentType: "image/jpeg",
    metadata: {
      ...(trackId && { trackId }),
      type: "album-art",
      contentHash,
    },
  });

  return {
    kind: "new",
    objectKey,
    contentHash,
    width: finalWidth,
    height: finalHeight,
    format: finalFormat,
    fileSize,
  };
}

/**
 * Create/associate the CoverImage row for an already-prepared cover image.
 *
 * This performs only fast DB writes (plus a re-check for concurrent dedup), so it
 * is safe to call inside a `prisma.$transaction` (pass the transaction client as
 * `tx`). The slow sharp/upload work must already have happened in
 * {@link prepareCoverImageUpload}.
 */
export async function createCoverImageInTx(
  tx: Prisma.TransactionClient,
  prepared: PreparedCoverImage,
  albumId?: string | null,
): Promise<{ id: string; objectKey: string }> {
  if (prepared.kind === "new") {
    // Re-check inside the transaction: a concurrent upload may have created the
    // same cover after prepare ran (contentHash is unique).
    const existing = await tx.coverImage.findUnique({
      where: { contentHash: prepared.contentHash },
      select: { id: true, objectKey: true },
    });

    let coverImage = existing;
    if (!coverImage) {
      coverImage = await tx.coverImage.create({
        data: {
          contentHash: prepared.contentHash,
          objectKey: prepared.objectKey,
          width: prepared.width,
          height: prepared.height,
          format: prepared.format,
          fileSize: prepared.fileSize,
        },
        select: { id: true, objectKey: true },
      });
    }

    if (albumId) {
      await associateCoverWithAlbumTx(tx, coverImage.id, albumId);
    }

    return coverImage;
  }

  // Reusing an existing cover (by content hash): associate the album only when it
  // still has no cover, mirroring findOrCreateCoverImage's behavior.
  if (prepared.kind === "existing" && albumId) {
    const album = await tx.album.findUnique({
      where: { id: albumId },
      select: { coverImageId: true },
    });
    if (album && !album.coverImageId) {
      await associateCoverWithAlbumTx(tx, prepared.id, albumId);
    }
  }

  return { id: prepared.id, objectKey: prepared.objectKey };
}

/**
 * Transaction-aware version of findOrCreateCoverImage.
 *
 * The file upload (sharp + Tigris write) happens OUTSIDE the transaction via
 * {@link prepareCoverImageUpload}; only fast DB writes run within the transaction
 * via {@link createCoverImageInTx}.
 */
export async function findOrCreateCoverImageTx(
  tx: Prisma.TransactionClient,
  params: CoverImageUploadParams,
): Promise<{ id: string; objectKey: string }> {
  const prepared = await prepareCoverImageUpload(params);
  return createCoverImageInTx(tx, prepared, params.albumId ?? null);
}
