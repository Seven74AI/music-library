import { requireUserId } from "#app/utils/auth.server.ts";
import {
  getPlayHistory,
  parseHistoryCursor,
  PLAY_HISTORY_PAGE_SIZE,
} from "#app/features/play-history/play-history.server.ts";

export async function loader({ request, url }: { request: Request; url: URL }) {
  const userId = await requireUserId(request);

  const rawLimit = url.searchParams.get("limit");
  let limit = PLAY_HISTORY_PAGE_SIZE;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return Response.json({ error: "Invalid limit parameter" }, { status: 400 });
    }
    limit = parsed;
  }

  const cursor = parseHistoryCursor(url.searchParams.get("cursor"));
  const { items, nextCursor } = await getPlayHistory({ userId, cursor, limit });
  return Response.json({ items, nextCursor });
}
