import { data } from "react-router";
import { z } from "zod";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/flag";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

const flagSchema = z.object({
  entityType: z.enum(["track", "artist", "album"]),
  entityId: z.string().min(1),
  issueType: z.enum(["wrong_metadata", "missing_info", "low_quality", "duplicate", "other"]),
  comment: z.string().max(500).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireCuratorRole(request);

  try {
    const formData = await request.formData();
    const rawData = Object.fromEntries(formData);
    const validatedData = flagSchema.parse(rawData);

    // Verify entity exists
    const entityExists = await verifyEntityExists(validatedData.entityType, validatedData.entityId);

    if (!entityExists) {
      return data({ success: false, error: "Entity not found" }, { status: 404 });
    }

    // Create review queue item
    await prisma.reviewQueueItem.create({
      data: {
        entityType: validatedData.entityType,
        entityId: validatedData.entityId,
        source: "curator",
        issueType: validatedData.issueType,
        description: validatedData.comment || null,
        reporterId: userId,
        status: "open",
        priority: 2, // Curator flags have higher priority
      },
    });

    return data({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return data({ success: false, error: "Invalid input data" }, { status: 400 });
    }
    console.error("Error flagging for review:", error);
    return data({ success: false, error: "Failed to flag for review" }, { status: 500 });
  }
}

async function verifyEntityExists(entityType: string, entityId: string): Promise<boolean> {
  switch (entityType) {
    case "track":
      const track = await prisma.track.findUnique({ where: { id: entityId } });
      return !!track;
    case "artist":
      const artist = await prisma.artist.findUnique({ where: { id: entityId } });
      return !!artist;
    case "album":
      const album = await prisma.album.findUnique({ where: { id: entityId } });
      return !!album;
    default:
      return false;
  }
}
