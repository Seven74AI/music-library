import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$id.claim.ts";

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireCuratorRole(request);
  const id = params.id;
  if (!id) throw data({ success: false, error: "Queue item not found" }, { status: 404 });

  const item = await prisma.reviewQueueItem.findUnique({ where: { id } });
  if (!item) return data({ success: false, error: "Queue item not found" }, { status: 404 });
  if (item.status !== "open") {
    return data(
      { success: false, error: "Queue item is not available for claiming" },
      { status: 400 },
    );
  }

  await prisma.reviewQueueItem.update({
    where: { id },
    data: { status: "claimed", claimedBy: userId, claimedAt: new Date() },
  });
  return data({ success: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
