import { promises as fs, constants, existsSync } from "node:fs";
import { isAbsolute, join, resolve, sep, win32 } from "node:path";
import { invariantResponse } from "@epic-web/invariant";
import { getImgResponse } from "openimg/node";
import { getDomainUrl } from "#app/utils/misc.tsx";
import { validateStorageKey } from "#app/utils/path-validation.server";
import { getFileUrl, getStorageOrigins } from "#app/utils/storage.server.ts";
import { type Route } from "./+types/images";

let cacheDir: string | null = null;

async function getCacheDir() {
  if (cacheDir) return cacheDir;

  let dir = "./tests/fixtures/openimg";
  if (process.env.NODE_ENV === "production") {
    const isAccessible = await fs
      .access("/data", constants.W_OK)
      .then(() => true)
      .catch(() => false);

    if (isAccessible) {
      dir = "/data/images";
    }
  }

  return (cacheDir = dir);
}

/**
 * Check if a string is a storage key (not a URL)
 * Storage keys typically start with 'images/' or 'audio/' and don't contain '://'
 */
function isStorageKey(value: string): boolean {
  // If it's a valid URL, it's not a storage key
  if (URL.canParse(value)) {
    return false;
  }
  // Storage keys typically start with 'images/' or 'audio/'
  return value.startsWith("images/") || value.startsWith("audio/");
}

function invalidImagePath(): Response {
  return new Response("Invalid image path", { status: 400 });
}

/**
 * Reject traversal, null bytes, and filesystem-absolute inputs before any read.
 * A single leading slash is a site path (`/img/...`, `/assets/...`) resolved under public/.
 */
function rejectDisallowedImagePath(value: string, mode: "storage" | "public"): void {
  if (value.includes("..") || value.includes("\0")) {
    throw invalidImagePath();
  }

  const sitePath = mode === "public" && value.startsWith("/") && !value.startsWith("//");
  if (sitePath) return;

  if (
    value.startsWith("//") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw invalidImagePath();
  }
}

/** Resolve a non-storage src under public/, including /assets sources. */
function resolvePublicImagePath(src: string): string {
  rejectDisallowedImagePath(src, "public");

  const relative = src.startsWith("/") ? src.slice(1) : src;
  if (
    relative.length === 0 ||
    relative.startsWith("/") ||
    relative.includes("..") ||
    relative.includes("\0") ||
    isAbsolute(relative) ||
    win32.isAbsolute(relative) ||
    /^[A-Za-z]:[\\/]/.test(relative)
  ) {
    throw invalidImagePath();
  }

  const root = resolve(process.cwd(), "public");
  const resolved = resolve(root, relative);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw invalidImagePath();
  }
  return resolved;
}

/** Resolve a storage key (objectKey or src-as-storage-key) to a local file or
 * signed fetch URL. Shared by both image source branches. */
async function resolveStorageKeySource(
  storageKey: string,
  context: { logLabel: string; fetchErrorMessage: string },
) {
  rejectDisallowedImagePath(storageKey, "storage");
  // Validate and sanitize the storage key to prevent path traversal
  let validatedKey: string;
  try {
    validatedKey = validateStorageKey(storageKey);
  } catch {
    throw invalidImagePath();
  }

  // Check for local file first (for local development)
  const localFilePath = join(process.cwd(), "tests", "fixtures", "uploaded", validatedKey);
  if (existsSync(localFilePath)) {
    return { type: "fs" as const, path: localFilePath };
  }

  // Generate signed URL for remote storage (Tigris/S3)
  try {
    const { url: signedUrl, headers: signedHeaders } = await getFileUrl(validatedKey, 3600);
    return { type: "fetch" as const, url: signedUrl, headers: signedHeaders };
  } catch (error) {
    // If storage is not configured and file not found locally, return 404
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("Storage is not configured")) {
      console.warn(`File not found locally and storage not configured: ${validatedKey}`);
      throw new Response("Image not found", { status: 404 });
    }
    console.error(`Error generating signed URL for ${context.logLabel}:`, error);
    throw new Response(context.fetchErrorMessage, { status: 500 });
  }
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const searchParams = url.searchParams;

  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  const objectKey = searchParams.get("objectKey");

  // Validate objectKey if provided
  if (objectKey && (typeof objectKey !== "string" || objectKey.trim().length === 0)) {
    throw new Response("Invalid objectKey parameter", { status: 400 });
  }

  return getImgResponse(request, {
    headers,
    allowlistedOrigins: [
      getDomainUrl(request),
      // Presigned Tigris URLs use the virtual-hosted origin
      // (https://{bucket}.fly.storage.tigris.dev) — openimg matches origins
      // exactly, so both storage origins must be listed.
      ...getStorageOrigins(),
      "https://i.ytimg.com",
      "https://img.youtube.com",
    ].filter(Boolean),
    cacheFolder: await getCacheDir(),
    getImgSource: async () => {
      // If objectKey is explicitly provided, use it
      if (objectKey) {
        return resolveStorageKeySource(objectKey, {
          logLabel: "image",
          fetchErrorMessage: "Failed to generate image URL",
        });
      }

      const src = searchParams.get("src");
      invariantResponse(src, "src query parameter is required", { status: 400 });
      rejectDisallowedImagePath(src, "public");

      // Check if src is a storage key (for local dev and Tigris)
      if (isStorageKey(src)) {
        return resolveStorageKeySource(src, {
          logLabel: "storage key",
          fetchErrorMessage: "Failed to generate image URL from storage key",
        });
      }

      if (URL.canParse(src)) {
        // Fetch image from external URL; will be matched against allowlist
        return {
          type: "fetch",
          url: src,
        };
      }
      // Site paths (/assets/...) and other public files stay inside public/.
      return {
        type: "fs",
        path: resolvePublicImagePath(src),
      };
    },
  });
}
