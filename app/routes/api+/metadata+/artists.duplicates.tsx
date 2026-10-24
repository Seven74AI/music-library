import { data } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { getArtistDuplicateGroups } from "#app/utils/duplicate-detection.server.ts";
import { type Route } from "./+types/artists.duplicates.ts";

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorOrAdmin(request);

  // Parse query parameters
  const url = new URL(request.url);
  const minTracks = parseInt(url.searchParams.get("minTracks") || "2", 10);

  // Read duplicate groups from the ADR-034 cache (normalized names + Levenshtein
  // fuzzy phase). This keeps the read path off the O(n²) live detection and
  // matches the groups surfaced by the curator duplicate dashboard.
  const { exact, fuzzy } = await getArtistDuplicateGroups();

  // Flatten exact+fuzzy groups into the metadata route's response shape, applying
  // the minTracks threshold the same way the previous in-memory grouping did.
  const validGroups = [...exact, ...fuzzy]
    .map((group) => {
      const filteredArtists = group.artists.filter((artist) => artist.trackCount >= minTracks);

      // Only return if at least one artist meets threshold
      if (filteredArtists.length === 0) {
        return null;
      }

      return {
        normalizedName: group.normalizedName,
        artists: filteredArtists,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null && g.artists.length > 1);

  return data({ groups: validGroups });
}
