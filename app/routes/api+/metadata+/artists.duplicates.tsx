import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { type Route } from "./+types/artists.duplicates.ts";

export async function loader({ request }: Route.LoaderArgs) {
  // Check curator/admin role
  const userId = await requireUserId(request);
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      roles: {
        some: {
          name: { in: ["curator", "admin"] },
        },
      },
    },
  });

  if (!user) {
    throw data(
      {
        error: "Unauthorized",
        message: "You must be a curator or admin to view duplicates",
      },
      { status: 403 },
    );
  }

  // Parse query parameters
  const url = new URL(request.url);
  const minTracks = parseInt(url.searchParams.get("minTracks") || "2", 10);

  // Find artists with duplicate normalized names
  // Get all non-merged artists with track and album counts
  const allArtists = await prisma.artist.findMany({
    where: {
      mergedIntoId: null,
    },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      _count: {
        select: {
          tracks: true,
          albums: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // Group by normalizedName in JavaScript
  const artistsByNormalizedName = new Map<string, typeof allArtists>();
  for (const artist of allArtists) {
    const existing = artistsByNormalizedName.get(artist.normalizedName) || [];
    existing.push(artist);
    artistsByNormalizedName.set(artist.normalizedName, existing);
  }

  // Filter groups to only include duplicates with artists meeting minTracks threshold
  const validGroups = Array.from(artistsByNormalizedName.entries())
    .filter(([_, artists]) => artists.length > 1) // Only groups with duplicates
    .map(([normalizedName, artists]) => {
      // Filter by minTracks
      const filteredArtists = artists.filter((artist) => artist._count.tracks >= minTracks);

      // Only return if at least one artist meets threshold
      if (filteredArtists.length === 0) {
        return null;
      }

      return {
        normalizedName,
        artists: filteredArtists.map((artist) => ({
          id: artist.id,
          name: artist.name,
          trackCount: artist._count.tracks,
          albumCount: artist._count.albums,
        })),
      };
    })
    .filter((g) => g !== null && g.artists.length > 1); // Ensure still duplicates after filtering

  return data({ groups: validGroups });
}
