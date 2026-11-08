import { listReviewQueue } from "#app/features/curator/review-queue.server.ts";
import { parsePageParam } from "#app/utils/parse-page-param.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";

export async function loader({ request }: { request: Request }) {
  const currentUserId = await requireCuratorRole(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "open";
  const result = await listReviewQueue({
    status,
    entityType: url.searchParams.get("entityType") || undefined,
    source: url.searchParams.get("source") || undefined,
    page: parsePageParam(url.searchParams.get("page")),
    claimedBy: status === "mine" ? currentUserId : undefined,
  });
  return { ...result, currentUserId };
}
