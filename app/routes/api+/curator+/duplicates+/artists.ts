/**
 * GET /api/curator/duplicates/artists
 * Fetch artist duplicate groups from the ADR-034 cache (DuplicateDetection table).
 */

import { data } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { getArtistDuplicateGroups } from "#app/utils/duplicate-detection.server.ts";
import type { Route } from "./+types/artists.ts";

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorOrAdmin(request);

  try {
    const { exact, fuzzy } = await getArtistDuplicateGroups();

    return data({
      exact,
      fuzzy,
      totalExactGroups: exact.length,
      totalFuzzyGroups: fuzzy.length,
    });
  } catch (error) {
    console.error("Error fetching artist duplicates:", error);
    throw new Response("Failed to fetch artist duplicates", { status: 500 });
  }
}
