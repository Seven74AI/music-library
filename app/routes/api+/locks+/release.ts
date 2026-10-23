import { data, type ActionFunctionArgs } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { releaseLock, type EntityType } from "#app/utils/locks.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { z } from "zod";
import { type Route } from "./+types/release.ts";

const ReleaseLockSchema = z.object({
  entityType: z.enum(["track", "artist", "album"]),
  entityId: z.string().min(1),
});

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireCuratorOrAdmin(request);

  const body = await request.json();
  const result = ReleaseLockSchema.safeParse(body);

  if (!result.success) {
    throw data({ error: "Invalid input", issues: result.error.issues }, { status: 400 });
  }

  const { entityType, entityId } = result.data;

  const outcome = await releaseLock(entityType as EntityType, entityId, userId);

  if (outcome === "not_found") {
    throw data({ error: "Lock not found" }, { status: 404 });
  }
  if (outcome === "not_owner") {
    throw data({ error: "Forbidden", message: "You do not own this lock" }, { status: 403 });
  }

  return { success: true };
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
