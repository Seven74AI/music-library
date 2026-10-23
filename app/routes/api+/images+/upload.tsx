import { data } from "react-router";
import { parseFormData } from "@mjackson/form-data-parser";
import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { uploadFile } from "#app/utils/storage.server.ts";
import { getImageDimensions } from "#app/utils/cover-management.server.ts";
import { isValidCoverEntityId, verifyCoverEntity } from "#app/utils/cover-entity.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/upload.ts";

// Image validation
const MIN_IMAGE_SIZE = 500; // 500x500 minimum
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Non-standard aliases some clients send (e.g. "image/jpg" instead of the
// canonical "image/jpeg"). Normalize rather than reject so real uploads that
// use the alias are not dropped.
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

// Canonical extension per MIME type — "image/jpeg" maps to "jpg" so the object
// key and `format` column are stable regardless of how the browser labels it.
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function normalizeImageType(rawType: string): string {
  return MIME_ALIASES[rawType] ?? rawType;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  await requireCuratorRole(request);

  // Parse multipart form data
  const formData = await parseFormData(request, { maxFileSize: MAX_IMAGE_SIZE });

  const imageFile = formData.get("image");
  const entityType = formData.get("entityType") as string; // 'artist' or 'album'
  const entityId = formData.get("entityId") as string;

  // Return 400 payloads so a fetcher keeps the editor mounted and can read
  // data.error. Throwing them makes serverAction() a route error instead.
  if (!imageFile || typeof imageFile === "string") {
    return data({ error: "Image file is required" }, { status: 400 });
  }

  if (!entityType || !["artist", "album"].includes(entityType)) {
    return data({ error: "Valid entityType is required (artist or album)" }, { status: 400 });
  }

  if (!entityId) {
    return data({ error: "entityId is required" }, { status: 400 });
  }

  // The object key must derive from a verified record, never the raw client id.
  if (!isValidCoverEntityId(entityId)) {
    return data({ error: "Invalid entityId" }, { status: 400 });
  }
  const verifiedEntityId = await verifyCoverEntity(entityType as "artist" | "album", entityId);
  if (!verifiedEntityId) {
    return data({ error: `${entityType} not found` }, { status: 404 });
  }

  // Convert file to buffer
  const arrayBuffer = await imageFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Validate file size
  if (buffer.length > MAX_IMAGE_SIZE) {
    return data(
      { error: `Image file too large. Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB` },
      { status: 400 },
    );
  }

  // Normalize aliases, then validate against the canonical allow-list
  const contentType = normalizeImageType(imageFile.type);
  if (!ALLOWED_TYPES.includes(contentType)) {
    return data(
      { error: `Invalid image type. Allowed types: ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  // Get image dimensions
  const { width, height } = await getImageDimensions(buffer);

  // Validate dimensions
  if (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) {
    return data(
      {
        error: `Image too small. Minimum size is ${MIN_IMAGE_SIZE}x${MIN_IMAGE_SIZE}px`,
        details: { width, height },
      },
      { status: 400 },
    );
  }

  // Calculate hash for deduplication
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  // Check if image already exists
  let coverImage = await prisma.coverImage.findUnique({
    where: { contentHash },
  });

  if (!coverImage) {
    // Upload to storage
    const fileId = createId();
    const extension = EXTENSION_BY_TYPE[contentType] ?? "jpg";
    const timestamp = Date.now();
    const objectKey = `images/${entityType}s/${verifiedEntityId}/${timestamp}-${fileId}.${extension}`;

    await uploadFile({
      file: buffer,
      key: objectKey,
      contentType,
    });

    // Create CoverImage record
    coverImage = await prisma.coverImage.create({
      data: {
        contentHash,
        objectKey,
        width,
        height,
        format: extension,
        fileSize: buffer.length,
      },
    });
  }

  return data({
    success: true,
    image: {
      id: coverImage.id,
      objectKey: coverImage.objectKey,
      width: coverImage.width,
      height: coverImage.height,
    },
  });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
