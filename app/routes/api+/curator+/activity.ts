import { getActivity } from "#app/features/curator/dashboard.server.ts";
import {
  ACTIVITY_PAGE_SIZE,
  activityToCsv,
  type ActivityEntityType,
} from "#app/features/curator/dashboard.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";

function parseDate(value: string | null, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export async function loader({ request }: { request: Request }) {
  await requireCuratorRole(request);
  const url = new URL(request.url);
  const entityParam = url.searchParams.get("entityType");
  const entityType =
    entityParam === "track" || entityParam === "artist" || entityParam === "album"
      ? (entityParam as ActivityEntityType)
      : undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const format = url.searchParams.get("format");
  const filters = {
    page: format === "csv" ? 1 : Number.isFinite(page) ? page : 1,
    pageSize: format === "csv" ? 5000 : ACTIVITY_PAGE_SIZE,
    curatorId: url.searchParams.get("curatorId") || undefined,
    entityType,
    from: parseDate(url.searchParams.get("from"), false),
    to: parseDate(url.searchParams.get("to"), true),
  };
  const result = await getActivity(filters);
  if (format === "csv") {
    return new Response(activityToCsv(result.items), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="curator-activity.csv"',
      },
    });
  }
  return result;
}
