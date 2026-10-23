import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { releaseStaleClaims } from "#app/features/curator/review-queue.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$id.claim.ts";

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireCuratorRole(request);
  const id = params.id;
  if (!id) throw data({ success: false, error: "Queue item not found" }, { status: 404 });

  // Reap stale claims first so an item claimed >2h ago (ADR-035) is claimable again.
  await releaseStaleClaims();
  const item = await prisma.reviewQueueItem.findUnique({ where: { id } });
  if (!item) return data({ success: false, error: "Queue item not found" }, { status: 404 });

  // Atomic conditional claim: only transition an item that is still 'open'.
  // A check-then-update would let two curators both read 'open' and both claim,
  // with the last writer silently stealing the claim.
  const result = await prisma.reviewQueueItem.updateMany({
    where: { id, status: "open" },
    data: { status: "claimed", claimedBy: userId, claimedAt: new Date() },
  });

  if (result.count === 0) {
    return data(
      { success: false, error: "Queue item is not available for claiming" },
      { status: 400 },
    );
  }

  return data({ success: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
