import { data, type ActionFunctionArgs } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
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
  await requireCuratorOrAdmin(request);
  const userId = await requireUserId(request);

  const body = await request.json();
  const result = ReleaseLockSchema.safeParse(body);

  if (!result.success) {
    throw data({ error: "Invalid input", issues: result.error.issues }, { status: 400 });
  }

  const { entityType, entityId } = result.data;

  const success = await releaseLock(entityType as EntityType, entityId, userId);

  if (!success) {
    throw data(
      {
        error: "Lock not found",
        message: "No lock found for this entity, or you do not own the lock",
      },
      { status: 404 },
    );
  }

  return { success: true };
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
