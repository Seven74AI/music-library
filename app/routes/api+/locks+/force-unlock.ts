import { data, type ActionFunctionArgs } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { forceUnlock, type EntityType } from "#app/utils/locks.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { z } from "zod";
import { type Route } from "./+types/force-unlock.ts";

const ForceUnlockSchema = z.object({
  entityType: z.enum(["track", "artist", "album"]),
  entityId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export async function action({ request }: ActionFunctionArgs) {
  const actorUserId = await requireCuratorOrAdmin(request);

  const body = await request.json();
  const result = ForceUnlockSchema.safeParse(body);

  if (!result.success) {
    throw data({ error: "Invalid input", issues: result.error.issues }, { status: 400 });
  }

  const { entityType, entityId, reason } = result.data;

  const success = await forceUnlock(entityType as EntityType, entityId, reason, actorUserId);

  if (!success) {
    throw data(
      {
        error: "Lock not found",
        message: "No lock found for this entity",
      },
      { status: 404 },
    );
  }

  return { success: true };
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
