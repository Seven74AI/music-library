import { data, type ActionFunctionArgs } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { acquireLock, type EntityType } from "#app/utils/locks.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { z } from "zod";
import { type Route } from "./+types/acquire.ts";

const AcquireLockSchema = z.object({
  entityType: z.enum(["track", "artist", "album"]),
  entityId: z.string().min(1),
});

export async function action({ request }: ActionFunctionArgs) {
  await requireCuratorOrAdmin(request);
  const userId = await requireUserId(request);

  const body = await request.json();
  const result = AcquireLockSchema.safeParse(body);

  if (!result.success) {
    throw data({ error: "Invalid input", issues: result.error.issues }, { status: 400 });
  }

  const { entityType, entityId } = result.data;

  const lock = await acquireLock(entityType as EntityType, entityId, userId);

  if (!lock) {
    throw data(
      {
        error: "Already locked",
        message: "This entity is currently locked by another curator",
      },
      { status: 409 },
    );
  }

  return { lock };
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
