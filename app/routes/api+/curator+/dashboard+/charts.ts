import { getDashboardCharts } from "#app/features/curator/dashboard.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  await requireCuratorRole(request);
  return getDashboardCharts();
}
