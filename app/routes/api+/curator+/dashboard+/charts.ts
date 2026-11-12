import { getDashboardCharts } from "#app/features/curator/dashboard.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  await requireCuratorOrAdmin(request);
  return getDashboardCharts();
}
