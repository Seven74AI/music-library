import { getDashboardMetrics } from "#app/features/curator/dashboard.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  await requireCuratorRole(request);
  const forceFresh = new URL(request.url).searchParams.get("refresh") === "1";
  return getDashboardMetrics({ forceFresh });
}

export function headers() {
  return { "Cache-Control": "private, max-age=0" };
}
