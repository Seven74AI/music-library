/**
 * POST /api/curator/duplicates/refresh
 * Manually trigger duplicate detection job
 * Admin/Curator only
 */

import { data } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { runDuplicateDetectionJob } from "#app/utils/duplicate-detection-job.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import type { Route } from "./+types/refresh.ts";

export async function action({ request }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);

  try {
    const result = await runDuplicateDetectionJob();

    return data({
      success: result.success,
      durationMs: result.durationMs,
      exactArtistGroups: result.exactArtistGroups,
      fuzzyArtistGroups: result.fuzzyArtistGroups,
      exactAlbumGroups: result.exactAlbumGroups,
      fuzzyAlbumGroups: result.fuzzyAlbumGroups,
      error: result.error,
    });
  } catch (error) {
    console.error("Error triggering duplicate detection:", error);
    throw new Response("Failed to trigger duplicate detection", { status: 500 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
