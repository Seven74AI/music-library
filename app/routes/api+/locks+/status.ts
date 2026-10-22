import { data, type LoaderFunctionArgs } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { getLockStatus, type EntityType } from "#app/utils/locks.server.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCuratorOrAdmin(request);

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");

  if (!entityType || !entityId) {
    throw data({ error: "Missing entityType or entityId" }, { status: 400 });
  }

  if (!["track", "artist", "album"].includes(entityType)) {
    throw data({ error: "Invalid entityType" }, { status: 400 });
  }

  const lock = await getLockStatus(entityType as EntityType, entityId);

  // Raw fetch in useLock reads JSON. A plain object is turbo-stream for loaders.
  return Response.json({ lock });
}
