import { data } from "react-router";
import { z } from "zod";
import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { uploadFile } from "#app/utils/storage.server.ts";
import { downloadExternalImage, getImageDimensions } from "#app/utils/cover-management.server.ts";
import { isValidCoverEntityId, verifyCoverEntity } from "#app/utils/cover-entity.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/from-url.ts";

const FromUrlSchema = z.object({
  url: z.string().url("Invalid URL"),
  entityType: z.enum(["artist", "album"], { message: "entityType must be 'artist' or 'album'" }),
  entityId: z.string().min(1, "entityId is required"),
});

// Image validation
const MIN_IMAGE_SIZE = 500; // 500x500 minimum

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  await requireCuratorRole(request);

  // Parse and validate request body
  const body = await request.json();
  const result = FromUrlSchema.safeParse(body);

  // Return 400 payloads so a fetcher keeps the editor mounted and can read
  // data.error. Throwing them makes serverAction() a route error instead.
  if (!result.success) {
    return data(
      {
        error: "Validation failed",
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  const { url, entityType, entityId } = result.data;

  // The object key must derive from a verified record, never the raw client id.
  // Reject path segments / `..` and nonexistent artist/album ids before upload.
  if (!isValidCoverEntityId(entityId)) {
    return data({ error: "Invalid entityId" }, { status: 400 });
  }
  const verifiedEntityId = await verifyCoverEntity(entityType, entityId);
  if (!verifiedEntityId) {
    return data({ error: `${entityType} not found` }, { status: 404 });
  }

  // Download image from URL
  const buffer = await downloadExternalImage(url);

  if (!buffer) {
    return data(
      {
        error: "Failed to download image from URL",
        details:
          "The URL may be invalid, the image may be too large, or the server may be unavailable",
      },
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
    const extension = "jpg";

    // Upload to storage
    const fileId = createId();
    const timestamp = Date.now();
    const objectKey = `images/${entityType}s/${verifiedEntityId}/${timestamp}-${fileId}.${extension}`;

    await uploadFile({
      file: buffer,
      key: objectKey,
      contentType: "image/jpeg",
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
