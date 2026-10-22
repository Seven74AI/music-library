import { data } from "react-router";
import { listCuratorBadges } from "#app/features/curator/badges.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  await requireCuratorRole(request);
  const userId = new URL(request.url).searchParams.get("userId");
  try {
    return await listCuratorBadges(userId);
  } catch (error) {
    console.error("Failed to load curator badges:", error);
    throw data({ error: "Could not load curator badges" }, { status: 500 });
  }
}
