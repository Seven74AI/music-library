import { getDashboardMetrics } from "#app/features/curator/dashboard.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  await requireCuratorOrAdmin(request);
  const forceFresh = new URL(request.url).searchParams.get("refresh") === "1";
  return getDashboardMetrics({ forceFresh });
}

export function headers() {
  return { "Cache-Control": "private, max-age=0" };
}
