import { data } from "react-router";
import { getLeaderboard } from "#app/features/curator/dashboard.server.ts";
import { isLeaderboardPeriod } from "#app/features/curator/dashboard.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  await requireCuratorRole(request);
  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period") ?? "week";
  if (!isLeaderboardPeriod(periodParam)) {
    throw data({ error: "Invalid period" }, { status: 400 });
  }
  const limitParam = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;
  return getLeaderboard({ period: periodParam, limit });
}
