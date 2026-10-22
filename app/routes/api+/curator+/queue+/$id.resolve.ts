import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { sendReviewResolutionEmail } from "#app/utils/queue-notifications.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$id.resolve.ts";

const resolveSchema = z.object({
  resolution: z.enum(["fixed", "not_an_issue", "duplicate", "cannot_fix"]),
  resolutionComment: z.string().min(1).max(1000),
});

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireCuratorRole(request);
  const id = params.id;
  if (!id) throw data({ success: false, error: "Queue item not found" }, { status: 404 });

  const formData = await request.formData();
  const parsed = resolveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return data({ success: false, error: "Invalid input data" }, { status: 400 });
  }

  const item = await prisma.reviewQueueItem.findUnique({
    where: { id },
    include: {
      reporter: {
        select: { id: true, email: true, username: true, name: true },
      },
    },
  });
  if (!item) return data({ success: false, error: "Queue item not found" }, { status: 404 });
  if (item.status !== "claimed") {
    return data(
      { success: false, error: "Queue item must be claimed before resolving" },
      { status: 400 },
    );
  }
  if (item.claimedBy !== userId) {
    return data(
      { success: false, error: "You can only resolve items you have claimed" },
      { status: 403 },
    );
  }

  const curator = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, name: true },
  });

  await prisma.reviewQueueItem.update({
    where: { id },
    data: {
      status: "resolved",
      resolution: parsed.data.resolution,
      resolutionComment: parsed.data.resolutionComment,
      resolvedBy: userId,
      resolvedAt: new Date(),
    },
  });

  if (item.reporter && item.source === "user_report") {
    await sendReviewResolutionEmail({
      reporter: item.reporter,
      curator: curator || { username: "Unknown", name: null },
      item: {
        entityType: item.entityType,
        entityId: item.entityId,
        issueType: item.issueType,
        description: item.description,
      },
      resolution: parsed.data.resolution,
      resolutionComment: parsed.data.resolutionComment,
    }).catch((err) => {
      console.error("Failed to send resolution email:", err);
    });
  }

  return data({ success: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
