/**
 * GET /api/curator/duplicates/albums
 * Fetch album duplicate groups from the ADR-034 cache (DuplicateDetection table).
 */

import { data } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { getAlbumDuplicateGroups } from "#app/utils/duplicate-detection.server.ts";
import type { Route } from "./+types/albums.ts";

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorOrAdmin(request);

  try {
    const { exact, fuzzy } = await getAlbumDuplicateGroups();

    return data({
      exact,
      fuzzy,
      totalExactGroups: exact.length,
      totalFuzzyGroups: fuzzy.length,
    });
  } catch (error) {
    console.error("Error fetching album duplicates:", error);
    throw new Response("Failed to fetch album duplicates", { status: 500 });
  }
}
